import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import {
    assertEmailVerified,
    getMembership,
    hashToken,
    memberCount,
    newToken,
    requireAuth,
    requireWorkspace,
    requireWorkspaceRow,
    rolePermissions,
    workspacePayload,
} from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok, parse } from '../lib/http.js';
import { emailSchema, workspaceNameSchema } from '../lib/validate.js';
import { EDITABLE_ROLE_KEYS, PERMISSION_KEYS, PERMISSION_KEY_SET, ROLES, ROLE_DEFAULTS, roleMeta } from '../permissions.js';
import type { MemberRow, WorkspaceRow } from '../types.js';

export const workspacesRouter = Router();
export const invitationsRouter = Router();

const memberPayload = (row: MemberRow, roleKey = row.role_key) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    roleKey,
    roleName: roleMeta(roleKey)?.name ?? roleKey,
    status: row.status,
    joinedAt: row.joined_at,
    lastActiveAt: row.last_active_at,
});

async function getMember(workspaceId: string, userId: string): Promise<MemberRow | undefined> {
    return one<MemberRow & { email: string; display_name: string; avatar_url: string | null }>(
        `SELECT m.*, u.email, u.display_name, u.avatar_url
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [workspaceId, userId],
    );
}

async function ownerCount(workspaceId: string): Promise<number> {
    const row = await one<{ count: string }>(
        "SELECT count(*)::text AS count FROM workspace_members WHERE workspace_id = $1 AND role_key = 'owner' AND status = 'active'",
        [workspaceId],
    );
    return Number(row?.count ?? 0);
}

async function uniqueSlug(name: string): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
        const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'workspace'}-${nanoid(6).toLowerCase()}`;
        const exists = await one('SELECT 1 FROM workspaces WHERE slug = $1', [slug]);
        if (!exists) return slug;
    }
    throw fail(500, 'INTERNAL_ERROR', '空间地址生成失败');
}

async function roleList(workspaceId: string) {
    const overrides = await query<{ key: string; permissions: string[] }>('SELECT key, permissions FROM workspace_roles WHERE workspace_id = $1', [workspaceId]);
    const overrideMap = new Map(overrides.map((row) => [row.key, row.permissions]));
    const counts = await query<{ role_key: string; count: string }>(
        "SELECT role_key, count(*)::text AS count FROM workspace_members WHERE workspace_id = $1 AND status = 'active' GROUP BY role_key",
        [workspaceId],
    );
    const countMap = new Map(counts.map((row) => [row.role_key, Number(row.count)]));
    return ROLES.map((role) => ({
        key: role.key,
        name: role.name,
        description: role.description,
        builtin: true,
        permissions: overrideMap.get(role.key) ?? ROLE_DEFAULTS[role.key],
        memberCount: countMap.get(role.key) ?? 0,
    }));
}

// ---------------------------------------------------------------------------
// 空间
// ---------------------------------------------------------------------------

workspacesRouter.get('/', async (req, res) => {
    const auth = requireAuth(req);
    const rows = await query<WorkspaceRow & { role_key: string; count: string; override_permissions: string[] | null }>(
        `SELECT w.*, m.role_key,
                (SELECT count(*)::text FROM workspace_members x WHERE x.workspace_id = w.id AND x.status = 'active') AS count,
                (SELECT r.permissions FROM workspace_roles r WHERE r.workspace_id = w.id AND r.key = m.role_key) AS override_permissions
         FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = $1 AND m.status = 'active' AND w.deleted_at IS NULL
         ORDER BY m.joined_at ASC`,
        [auth.user.id],
    );
    ok(res, {
        items: rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            roleKey: row.role_key,
            roleName: roleMeta(row.role_key)?.name ?? row.role_key,
            permissions: row.override_permissions ?? ROLE_DEFAULTS[row.role_key] ?? [],
            memberCount: Number(row.count),
            ownerId: row.owner_id,
            createdAt: row.created_at,
        })),
    });
});

workspacesRouter.post('/', async (req, res) => {
    const auth = requireAuth(req);
    assertEmailVerified(auth.user);
    const body = parse(z.object({ name: workspaceNameSchema }), req.body);
    const id = nanoid();
    await tx(async (client) => {
        await client.query('INSERT INTO workspaces (id, name, slug, owner_id) VALUES ($1,$2,$3,$4)', [
            id,
            body.name,
            await uniqueSlug(body.name),
            auth.user.id,
        ]);
        await client.query("INSERT INTO workspace_members (workspace_id, user_id, role_key, status) VALUES ($1,$2,'owner','active')", [
            id,
            auth.user.id,
        ]);
    });
    await writeAudit({
        workspaceId: id,
        actorId: auth.user.id,
        actorName: auth.user.display_name,
        actorIp: req.ip,
        action: 'workspace.create',
        targetType: 'workspace',
        targetId: id,
        diff: { name: body.name },
    });
    const workspace = await requireWorkspaceRow(id);
    ok(res, workspacePayload({ workspace, member: {} as MemberRow, roleKey: 'owner', roleName: '所有者', permissions: ROLE_DEFAULTS.owner }, 1));
});

workspacesRouter.get('/:id', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'workspace.read');
    ok(res, { ...workspacePayload(ctx, await memberCount(ctx.workspace.id)), updatedAt: ctx.workspace.updated_at });
});

workspacesRouter.patch('/:id', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'workspace.update');
    const body = parse(z.object({ name: workspaceNameSchema.optional() }), req.body);
    if (!body.name) throw fail(400, 'INVALID_PARAM', '没有需要更新的字段');
    const updated = await one<WorkspaceRow>('UPDATE workspaces SET name = $2, updated_at = now() WHERE id = $1 RETURNING *', [
        ctx.workspace.id,
        body.name,
    ]);
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'workspace.rename',
        targetType: 'workspace',
        targetId: ctx.workspace.id,
        diff: { from: ctx.workspace.name, to: body.name },
    });
    ok(res, {
        ...workspacePayload({ ...ctx, workspace: updated! }, await memberCount(ctx.workspace.id)),
        updatedAt: updated!.updated_at,
    });
});

workspacesRouter.delete('/:id', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'workspace.delete');
    const body = parse(z.object({ name: z.string().trim().min(1) }), req.body);
    if (body.name !== ctx.workspace.name) throw fail(400, 'INVALID_PARAM', '空间名不匹配，无法解散');
    await query('UPDATE workspaces SET deleted_at = now(), updated_at = now() WHERE id = $1', [ctx.workspace.id]);
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'workspace.delete',
        targetType: 'workspace',
        targetId: ctx.workspace.id,
        diff: { name: ctx.workspace.name },
    });
    ok(res, { deleted: true });
});

workspacesRouter.post('/:id/transfer-owner', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'workspace.ownership.transfer');
    const body = parse(z.object({ userId: z.string().min(1), workspaceName: z.string().trim().min(1) }), req.body);
    if (body.workspaceName !== ctx.workspace.name) throw fail(400, 'INVALID_PARAM', '空间名不匹配，无法转让');
    if (body.userId === ctx.workspace.owner_id) throw fail(400, 'INVALID_PARAM', '该成员已是所有者');
    const target = await getMember(ctx.workspace.id, body.userId);
    if (!target || target.status !== 'active') throw fail(404, 'NOT_FOUND', '成员不存在');

    await tx(async (client) => {
        await client.query('UPDATE workspaces SET owner_id = $2, updated_at = now() WHERE id = $1', [ctx.workspace.id, body.userId]);
        await client.query('UPDATE workspace_members SET role_key = $3 WHERE workspace_id = $1 AND user_id = $2', [
            ctx.workspace.id,
            body.userId,
            'owner',
        ]);
        if (ctx.member.user_id !== body.userId) {
            await client.query('UPDATE workspace_members SET role_key = $3 WHERE workspace_id = $1 AND user_id = $2', [
                ctx.workspace.id,
                ctx.member.user_id,
                'admin',
            ]);
        }
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'workspace.transfer',
        targetType: 'workspace',
        targetId: ctx.workspace.id,
        diff: { from: ctx.workspace.owner_id, to: body.userId },
    });
    ok(res, { ownerId: body.userId });
});

// ---------------------------------------------------------------------------
// 成员
// ---------------------------------------------------------------------------

workspacesRouter.get('/:id/members', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'member.read');
    const rows = await query<MemberRow>(
        `SELECT m.*, u.email, u.display_name, u.avatar_url
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 AND m.status = 'active'
         ORDER BY (m.role_key = 'owner') DESC, m.joined_at ASC`,
        [ctx.workspace.id],
    );
    ok(res, { items: rows.map((row) => memberPayload(row)), total: rows.length });
});

workspacesRouter.patch('/:id/members/:userId', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'member.update');
    const body = parse(z.object({ roleKey: z.string().min(1).max(40) }), req.body);
    const target = await getMember(ctx.workspace.id, req.params.userId);
    if (!target || target.status !== 'active') throw fail(404, 'NOT_FOUND', '成员不存在');
    if (!roleMeta(body.roleKey)) throw fail(400, 'INVALID_PARAM', '角色不存在');
    if (target.user_id === ctx.member.user_id) throw fail(403, 'PERMISSION_DENIED', '不能修改自己的角色');
    if (body.roleKey === 'owner' && ctx.roleKey !== 'owner') {
        throw fail(403, 'PERMISSION_DENIED', '只有所有者可以授予所有者');
    }
    if (target.role_key === 'owner' && ctx.roleKey !== 'owner') {
        throw fail(403, 'PERMISSION_DENIED', '只有所有者可以调整所有者');
    }
    const targetPermissions = await rolePermissions(ctx.workspace.id, body.roleKey);
    if (ctx.roleKey !== 'owner') {
        const missing = targetPermissions.find((key) => !ctx.permissions.includes(key));
        if (missing) throw fail(403, 'PERMISSION_DENIED', `不能授予自己没有的权限点：${missing}`, { missingPermission: missing });
    }
    if (target.role_key === 'owner' && body.roleKey !== 'owner' && (await ownerCount(ctx.workspace.id)) <= 1) {
        throw fail(400, 'LAST_OWNER', '至少保留一名所有者');
    }
    await query('UPDATE workspace_members SET role_key = $3 WHERE workspace_id = $1 AND user_id = $2', [
        ctx.workspace.id,
        target.user_id,
        body.roleKey,
    ]);
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'member.update',
        targetType: 'member',
        targetId: target.user_id,
        diff: { from: target.role_key, to: body.roleKey },
    });
    ok(res, memberPayload(target, body.roleKey));
});

workspacesRouter.delete('/:id/members/:userId', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'member.remove');
    const target = await getMember(ctx.workspace.id, req.params.userId);
    if (!target || target.status !== 'active') throw fail(404, 'NOT_FOUND', '成员不存在');
    if (target.role_key === 'owner') {
        if (ctx.roleKey !== 'owner') throw fail(403, 'PERMISSION_DENIED', '只有所有者可以移除所有者');
        if ((await ownerCount(ctx.workspace.id)) <= 1) throw fail(400, 'LAST_OWNER', '至少保留一名所有者');
    }
    if (target.user_id === ctx.workspace.owner_id) throw fail(400, 'LAST_OWNER', '请先转让所有者再退出空间');
    await query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [ctx.workspace.id, target.user_id]);
    await query('DELETE FROM project_collaborators WHERE user_id = $1 AND project_id IN (SELECT id FROM projects WHERE workspace_id = $2)', [
        target.user_id,
        ctx.workspace.id,
    ]);
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'member.remove',
        targetType: 'member',
        targetId: target.user_id,
        diff: { roleKey: target.role_key },
    });
    ok(res, { removed: true });
});

// ---------------------------------------------------------------------------
// 角色
// ---------------------------------------------------------------------------

workspacesRouter.get('/:id/roles', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'role.read');
    ok(res, { items: await roleList(ctx.workspace.id) });
});

workspacesRouter.patch('/:id/roles/:key', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'role.manage');
    const key = req.params.key;
    if (!EDITABLE_ROLE_KEYS.includes(key)) throw fail(403, 'PERMISSION_DENIED', '该内置角色的权限不可编辑');
    const body = parse(z.object({ permissions: z.array(z.string().min(1)).max(PERMISSION_KEYS.length) }), req.body);
    const permissions = [...new Set(body.permissions)];
    const unknown = permissions.find((perm) => !PERMISSION_KEY_SET.has(perm));
    if (unknown) throw fail(400, 'INVALID_PARAM', `未知权限点：${unknown}`);
    if (ctx.roleKey !== 'owner') {
        const missing = permissions.find((perm) => !ctx.permissions.includes(perm));
        if (missing) throw fail(403, 'PERMISSION_DENIED', `不能授予自己没有的权限点：${missing}`, { missingPermission: missing });
    }
    await query(
        `INSERT INTO workspace_roles (workspace_id, key, permissions, updated_at) VALUES ($1,$2,$3, now())
         ON CONFLICT (workspace_id, key) DO UPDATE SET permissions = $3, updated_at = now()`,
        [ctx.workspace.id, key, JSON.stringify(permissions)],
    );
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'role.update',
        targetType: 'role',
        targetId: key,
        diff: { permissions },
    });
    const items = await roleList(ctx.workspace.id);
    ok(res, { role: items.find((role) => role.key === key) });
});

// ---------------------------------------------------------------------------
// 邀请
// ---------------------------------------------------------------------------

const invitePayload = (row: {
    id: string;
    email: string | null;
    role_key: string;
    status: string;
    expires_at: Date;
    max_uses: number;
    used_count: number;
    created_at: Date;
}) => ({
    id: row.id,
    email: row.email,
    roleKey: row.role_key,
    status: row.expires_at.getTime() <= Date.now() && row.status === 'pending' ? 'expired' : row.status,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    createdAt: row.created_at,
});

workspacesRouter.get('/:id/invitations', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'member.invite');
    const rows = await query<{
        id: string;
        email: string | null;
        role_key: string;
        status: string;
        expires_at: Date;
        max_uses: number;
        used_count: number;
        created_at: Date;
    }>('SELECT * FROM invitations WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100', [ctx.workspace.id]);
    ok(res, { items: rows.map((row) => invitePayload(row)) });
});

workspacesRouter.post('/:id/invitations', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'member.invite');
    const body = parse(
        z.object({
            email: emailSchema.optional(),
            roleKey: z.string().min(1).max(40).default('viewer'),
            expiresInDays: z.number().int().min(1).max(30).default(7),
            maxUses: z.number().int().min(1).max(100).default(1),
        }),
        req.body,
    );
    if (!roleMeta(body.roleKey)) throw fail(400, 'INVALID_PARAM', '角色不存在');
    if (body.roleKey === 'owner') throw fail(400, 'INVALID_PARAM', '邀请不能授予所有者角色');
    if (ctx.roleKey !== 'owner') {
        const missing = (await rolePermissions(ctx.workspace.id, body.roleKey)).find((perm) => !ctx.permissions.includes(perm));
        if (missing) throw fail(403, 'PERMISSION_DENIED', `不能授予自己没有的权限点：${missing}`, { missingPermission: missing });
    }
    const token = newToken();
    const id = nanoid();
    const rows = await query<{
        id: string;
        email: string | null;
        role_key: string;
        status: string;
        expires_at: Date;
        max_uses: number;
        used_count: number;
        created_at: Date;
    }>(
        `INSERT INTO invitations (id, workspace_id, email, role_key, token_hash, expires_at, max_uses, created_by)
         VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval, $7, $8)
         RETURNING *`,
        [id, ctx.workspace.id, body.email ?? null, body.roleKey, hashToken(token), String(body.expiresInDays), body.maxUses, ctx.member.user_id],
    );
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'invitation.create',
        targetType: 'invitation',
        targetId: id,
        diff: { email: body.email ?? null, roleKey: body.roleKey, maxUses: body.maxUses },
    });
    ok(res, { invitation: invitePayload(rows[0]), token, inviteUrl: `/invite/${token}` }, 201);
});

workspacesRouter.delete('/:id/invitations/:invitationId', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'member.invite');
    const updated = await query(
        "UPDATE invitations SET status = 'revoked' WHERE id = $1 AND workspace_id = $2 AND status = 'pending' RETURNING id",
        [req.params.invitationId, ctx.workspace.id],
    );
    if (updated.length === 0) throw fail(404, 'NOT_FOUND', '邀请不存在或已失效');
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'invitation.revoke',
        targetType: 'invitation',
        targetId: req.params.invitationId,
    });
    ok(res, { revoked: true });
});

// ---------------------------------------------------------------------------
// 公开邀请信息 / 接受邀请
// ---------------------------------------------------------------------------

async function loadInvitation(token: string) {
    const row = await one<
        {
            id: string;
            workspace_id: string;
            email: string | null;
            role_key: string;
            status: string;
            expires_at: Date;
            max_uses: number;
            used_count: number;
            created_by: string;
            created_at: Date;
            workspace_name: string;
            inviter_name: string;
        }
    >(
        `SELECT i.*, w.name AS workspace_name, u.display_name AS inviter_name
         FROM invitations i
         JOIN workspaces w ON w.id = i.workspace_id AND w.deleted_at IS NULL
         LEFT JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = $1`,
        [hashToken(token)],
    );
    if (!row) throw fail(404, 'NOT_FOUND', '邀请不存在或已失效');
    return row;
}

function inviteState(row: { status: string; expires_at: Date; used_count: number; max_uses: number }): string {
    if (row.status === 'revoked') return 'revoked';
    if (row.used_count >= row.max_uses) return row.status === 'accepted' ? 'accepted' : 'used';
    if (row.expires_at.getTime() <= Date.now()) return 'expired';
    return 'pending';
}

invitationsRouter.get('/:token', async (req, res) => {
    const row = await loadInvitation(req.params.token);
    ok(res, {
        workspaceName: row.workspace_name,
        inviterName: row.inviter_name,
        roleKey: row.role_key,
        roleName: roleMeta(row.role_key)?.name ?? row.role_key,
        email: row.email,
        status: inviteState(row),
        expiresAt: row.expires_at,
    });
});

invitationsRouter.post('/:token/accept', async (req, res) => {
    const auth = requireAuth(req);
    assertEmailVerified(auth.user);
    const row = await loadInvitation(req.params.token);
    const state = inviteState(row);
    if (state !== 'pending') throw fail(400, 'INVITATION_INVALID', '邀请已失效或已被使用');
    if (row.email && row.email !== auth.user.email) {
        throw fail(403, 'PERMISSION_DENIED', '该邀请仅限指定邮箱使用');
    }
    const existing = await getMembership(row.workspace_id, auth.user.id);
    if (!existing) {
        await tx(async (client) => {
            await client.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role_key, status, invited_by)
                 VALUES ($1,$2,$3,'active',$4)
                 ON CONFLICT (workspace_id, user_id) DO NOTHING`,
                [row.workspace_id, auth.user.id, row.role_key, row.created_by],
            );
            await client.query('UPDATE invitations SET used_count = used_count + 1 WHERE id = $1', [row.id]);
            await client.query(
                `UPDATE invitations SET status = CASE WHEN used_count >= max_uses OR email IS NOT NULL THEN 'accepted' ELSE status END WHERE id = $1`,
                [row.id],
            );
        });
        await writeAudit({
            workspaceId: row.workspace_id,
            actorId: auth.user.id,
            actorName: auth.user.display_name,
            actorIp: req.ip,
            action: 'invitation.accept',
            targetType: 'invitation',
            targetId: row.id,
            diff: { roleKey: row.role_key },
        });
    }
    const membership = (await getMembership(row.workspace_id, auth.user.id))!;
    ok(
        res,
        workspacePayload(
            {
                workspace: membership.workspace,
                member: membership.member,
                roleKey: membership.member.role_key,
                roleName: roleMeta(membership.member.role_key)?.name ?? membership.member.role_key,
                permissions: await rolePermissions(row.workspace_id, membership.member.role_key),
            },
            await memberCount(row.workspace_id),
        ),
    );
});
