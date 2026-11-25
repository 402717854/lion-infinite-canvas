import { Router, type Request } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import {
    assertEmailVerified,
    getMembership,
    requireAuth,
    requireWorkspace,
    rolePermissions,
} from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok, parse } from '../lib/http.js';
import type { MemberRow, ProjectRow, WorkspaceRow } from '../types.js';

export const workspaceProjectsRouter = Router();
export const projectsRouter = Router();
export const importRouter = Router();

interface ProjectWithMeta extends ProjectRow {
    owner_name: string;
    collaborator_count: string;
}

const VISIBILITIES = ['private', 'workspace'] as const;

const projectMeta = (row: ProjectWithMeta) => ({
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    visibility: row.visibility,
    nodeCount: row.node_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnailUrl: row.thumbnail_url,
    collaboratorCount: Number(row.collaborator_count),
});

function normalizeDoc(doc: unknown): Record<string, unknown> {
    const input = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
    return {
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        ...input,
    };
}

const nodeCountOf = (doc: Record<string, unknown>) => (Array.isArray(doc.nodes) ? doc.nodes.length : 0);

async function projectWithMeta(projectId: string): Promise<ProjectWithMeta | undefined> {
    return one<ProjectWithMeta>(
        `SELECT p.*, u.display_name AS owner_name,
                (SELECT count(*)::text FROM project_collaborators c WHERE c.project_id = p.id) AS collaborator_count
         FROM projects p JOIN users u ON u.id = p.owner_id
         WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [projectId],
    );
}

interface ProjectAccess {
    project: ProjectWithMeta;
    workspace: WorkspaceRow;
    member: MemberRow;
    roleKey: string;
    permissions: string[];
    isOwner: boolean;
    collaboratorAccess: 'view' | 'edit' | null;
    canRead: boolean;
    canEdit: boolean;
    canManage: boolean;
}

/** 项目 ACL：先确认空间成员（非成员 404），再按可见性与协作者判定。 */
async function projectAccess(req: Request, projectId: string): Promise<ProjectAccess> {
    const auth = requireAuth(req);
    const project = await projectWithMeta(projectId);
    if (!project) throw fail(404, 'NOT_FOUND', '项目不存在或无权访问');
    const membership = await getMembership(project.workspace_id, auth.user.id);
    if (!membership) throw fail(404, 'NOT_FOUND', '项目不存在或无权访问');
    assertEmailVerified(auth.user);
    const permissions = await rolePermissions(project.workspace_id, membership.member.role_key);
    const collab = await one<{ access: 'view' | 'edit' }>('SELECT access FROM project_collaborators WHERE project_id = $1 AND user_id = $2', [
        project.id,
        auth.user.id,
    ]);
    const isOwner = project.owner_id === auth.user.id;
    const canRead =
        isOwner ||
        Boolean(collab) ||
        (membership.member.role_key !== 'guest' && project.visibility === 'workspace' && permissions.includes('project.read'));
    if (!canRead) throw fail(404, 'NOT_FOUND', '项目不存在或无权访问');
    const canEdit = isOwner || collab?.access === 'edit' || permissions.includes('project.update');
    return {
        project,
        workspace: membership.workspace,
        member: membership.member,
        roleKey: membership.member.role_key,
        permissions,
        isOwner,
        collaboratorAccess: collab?.access ?? null,
        canRead,
        canEdit,
        canManage: isOwner || permissions.includes('project.update'),
    };
}

const collaboratorMissing = (collab: { access: string } | undefined): boolean => !collab;

function requireEdit(access: ProjectAccess): void {
    if (access.canEdit) return;
    if (!access.permissions.includes('project.update')) {
        throw fail(403, 'PERMISSION_DENIED', '缺少权限点：project.update', { missingPermission: 'project.update' });
    }
    throw fail(403, 'PERMISSION_DENIED', '没有编辑该项目的权限');
}

function requireManage(access: ProjectAccess): void {
    if (access.canManage) return;
    if (!access.permissions.includes('project.update')) {
        throw fail(403, 'PERMISSION_DENIED', '缺少权限点：project.update', { missingPermission: 'project.update' });
    }
    throw fail(403, 'PERMISSION_DENIED', '没有管理该项目的权限');
}

async function collaboratorList(projectId: string) {
    const rows = await query<{ user_id: string; access: string; display_name: string; email: string }>(
        `SELECT c.user_id, c.access, u.display_name, u.email
         FROM project_collaborators c JOIN users u ON u.id = c.user_id
         WHERE c.project_id = $1 ORDER BY c.created_at ASC`,
        [projectId],
    );
    return rows.map((row) => ({ userId: row.user_id, displayName: row.display_name, email: row.email, access: row.access }));
}

// ---------------------------------------------------------------------------
// 空间下的项目列表 / 创建
// ---------------------------------------------------------------------------

workspaceProjectsRouter.get('/:id/projects', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'project.read');
    const includeWorkspaceVisible = ctx.roleKey !== 'guest';
    const rows = await query<ProjectWithMeta>(
        `SELECT p.*, u.display_name AS owner_name,
                (SELECT count(*)::text FROM project_collaborators c WHERE c.project_id = p.id) AS collaborator_count
         FROM projects p JOIN users u ON u.id = p.owner_id
         WHERE p.workspace_id = $1 AND p.deleted_at IS NULL
           AND (p.owner_id = $2
                OR EXISTS (SELECT 1 FROM project_collaborators c WHERE c.project_id = p.id AND c.user_id = $2)
                OR ($3::boolean AND p.visibility = 'workspace'))
         ORDER BY p.updated_at DESC`,
        [ctx.workspace.id, ctx.member.user_id, includeWorkspaceVisible],
    );
    ok(res, { items: rows.map((row) => projectMeta(row)) });
});

workspaceProjectsRouter.post('/:id/projects', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'project.create');
    const body = parse(
        z.object({
            title: z.string().trim().min(1, '项目名称不能为空').max(120),
            visibility: z.enum(VISIBILITIES).default('private'),
            doc: z.record(z.unknown()).optional(),
        }),
        req.body,
    );
    const projectId = nanoid();
    const doc = normalizeDoc(body.doc);
    await tx(async (client) => {
        await client.query(
            `INSERT INTO projects (id, workspace_id, owner_id, title, visibility, node_count, version)
             VALUES ($1,$2,$3,$4,$5,$6,1)`,
            [projectId, ctx.workspace.id, ctx.member.user_id, body.title, body.visibility, nodeCountOf(doc)],
        );
        await client.query('INSERT INTO project_docs (project_id, doc, version) VALUES ($1,$2,1)', [projectId, JSON.stringify(doc)]);
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'project.create',
        targetType: 'project',
        targetId: projectId,
        diff: { title: body.title, visibility: body.visibility },
    });
    const project = (await projectWithMeta(projectId))!;
    ok(res, { ...projectMeta(project), doc, permissions: { canRead: true, canEdit: true, canManage: true } }, 201);
});

// ---------------------------------------------------------------------------
// 单个项目
// ---------------------------------------------------------------------------

projectsRouter.get('/:id', async (req, res) => {
    const access = await projectAccess(req, req.params.id);
    const docRow = await one<{ doc: Record<string, unknown> }>('SELECT doc FROM project_docs WHERE project_id = $1', [access.project.id]);
    ok(res, {
        project: {
            ...projectMeta(access.project),
            workspaceId: access.project.workspace_id,
            doc: normalizeDoc(docRow?.doc),
            permissions: {
                canRead: access.canRead,
                canEdit: access.canEdit,
                canManage: access.canManage,
            },
        },
    });
});

projectsRouter.put('/:id', async (req, res) => {
    const access = await projectAccess(req, req.params.id);
    requireEdit(access);
    const body = parse(
        z.object({
            title: z.string().trim().min(1).max(120).optional(),
            doc: z.record(z.unknown()),
            version: z.number().int().min(1),
        }),
        req.body,
    );
    const doc = normalizeDoc(body.doc);
    const updated = await tx(async (client) => {
        const rows = await client.query<{ version: number; updated_at: Date }>(
            `UPDATE projects SET title = COALESCE($2, title), version = version + 1,
                    node_count = $3, updated_at = now()
             WHERE id = $1 AND version = $4 AND deleted_at IS NULL
             RETURNING version, updated_at`,
            [access.project.id, body.title ?? null, nodeCountOf(doc), body.version],
        );
        if (rows.rowCount === 0) throw fail(409, 'VERSION_CONFLICT', '项目已被他人更新，请刷新后重试');
        await client.query('UPDATE project_docs SET doc = $2, version = $3 WHERE project_id = $1', [
            access.project.id,
            JSON.stringify(doc),
            rows.rows[0].version,
        ]);
        return rows.rows[0];
    });
    await writeAudit({
        workspaceId: access.project.workspace_id,
        actorId: access.member.user_id,
        actorName: access.member.display_name,
        actorIp: req.ip,
        action: 'project.save',
        targetType: 'project',
        targetId: access.project.id,
        diff: { version: updated.version, nodeCount: nodeCountOf(doc) },
    });
    ok(res, { version: updated.version, updatedAt: updated.updated_at });
});

projectsRouter.delete('/:id', async (req, res) => {
    const access = await projectAccess(req, req.params.id);
    if (!access.permissions.includes('project.delete')) {
        throw fail(403, 'PERMISSION_DENIED', '缺少权限点：project.delete', { missingPermission: 'project.delete' });
    }
    await query('UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = $1', [access.project.id]);
    await writeAudit({
        workspaceId: access.project.workspace_id,
        actorId: access.member.user_id,
        actorName: access.member.display_name,
        actorIp: req.ip,
        action: 'project.delete',
        targetType: 'project',
        targetId: access.project.id,
        diff: { title: access.project.title },
    });
    ok(res, { deleted: true });
});

// ---------------------------------------------------------------------------
// 协作者
// ---------------------------------------------------------------------------

projectsRouter.post('/:id/collaborators', async (req, res) => {
    const access = await projectAccess(req, req.params.id);
    requireManage(access);
    const body = parse(z.object({ userId: z.string().min(1), access: z.enum(['view', 'edit']).default('view') }), req.body);
    const member = await one<{ user_id: string }>(
        "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'",
        [access.project.workspace_id, body.userId],
    );
    if (!member) throw fail(404, 'NOT_FOUND', '成员不存在');
    await query(
        `INSERT INTO project_collaborators (project_id, user_id, access) VALUES ($1,$2,$3)
         ON CONFLICT (project_id, user_id) DO UPDATE SET access = $3`,
        [access.project.id, body.userId, body.access],
    );
    await writeAudit({
        workspaceId: access.project.workspace_id,
        actorId: access.member.user_id,
        actorName: access.member.display_name,
        actorIp: req.ip,
        action: 'project.share',
        targetType: 'project',
        targetId: access.project.id,
        diff: { userId: body.userId, access: body.access },
    });
    ok(res, { items: await collaboratorList(access.project.id) });
});

projectsRouter.delete('/:id/collaborators/:userId', async (req, res) => {
    const access = await projectAccess(req, req.params.id);
    requireManage(access);
    const removed = await query('DELETE FROM project_collaborators WHERE project_id = $1 AND user_id = $2 RETURNING user_id', [
        access.project.id,
        req.params.userId,
    ]);
    if (removed.length === 0) throw fail(404, 'NOT_FOUND', '协作者不存在');
    await writeAudit({
        workspaceId: access.project.workspace_id,
        actorId: access.member.user_id,
        actorName: access.member.display_name,
        actorIp: req.ip,
        action: 'project.unshare',
        targetType: 'project',
        targetId: access.project.id,
        diff: { userId: req.params.userId },
    });
    ok(res, { items: await collaboratorList(access.project.id) });
});

// ---------------------------------------------------------------------------
// 本地数据迁移（逐项结果，不做整体事务）
// ---------------------------------------------------------------------------

const importProjectSchema = z.object({
    id: z.string().min(6).max(64).optional(),
    title: z.string().trim().min(1).max(200),
    doc: z.record(z.unknown()).default({}),
    visibility: z.enum(VISIBILITIES).default('private'),
});

const importAssetSchema = z.object({
    id: z.string().min(6).max(64).optional(),
    kind: z.enum(['text', 'image', 'video', 'audio']).default('image'),
    title: z.string().trim().min(1).max(200),
    coverUrl: z.string().max(2048).optional(),
    tags: z.array(z.string()).default([]),
    source: z.string().max(200).optional(),
    note: z.string().max(2000).optional(),
    storageKey: z.string().max(128).optional(),
    bytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().max(200).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    visibility: z.enum(VISIBILITIES).default('workspace'),
});

async function pickId(preferred: string | undefined): Promise<string> {
    if (preferred) {
        const exists = await one('SELECT 1 FROM projects WHERE id = $1', [preferred]);
        const assetExists = await one('SELECT 1 FROM assets WHERE id = $1', [preferred]);
        if (!exists && !assetExists) return preferred;
    }
    return nanoid();
}

importRouter.post('/:id/import', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'project.create');
    const body = parse(
        z.object({
            projects: z.array(z.unknown()).max(500).default([]),
            assets: z.array(z.unknown()).max(500).default([]),
        }),
        req.body,
    );
    if (body.assets.length > 0 && !ctx.permissions.includes('asset.create')) {
        throw fail(403, 'PERMISSION_DENIED', '缺少权限点：asset.create', { missingPermission: 'asset.create' });
    }

    const created: { index: number; type: 'project' | 'asset'; id: string; title: string }[] = [];
    const failed: { index: number; reason: string }[] = [];

    for (const [index, item] of body.projects.entries()) {
        const parsed = importProjectSchema.safeParse(item);
        if (!parsed.success) {
            failed.push({ index, reason: parsed.error.issues[0].message });
            continue;
        }
        try {
            const id = await pickId(parsed.data.id);
            const doc = normalizeDoc(parsed.data.doc);
            await tx(async (client) => {
                await client.query(
                    `INSERT INTO projects (id, workspace_id, owner_id, title, visibility, node_count, version)
                     VALUES ($1,$2,$3,$4,$5,$6,1)`,
                    [id, ctx.workspace.id, ctx.member.user_id, parsed.data.title, parsed.data.visibility, nodeCountOf(doc)],
                );
                await client.query('INSERT INTO project_docs (project_id, doc, version) VALUES ($1,$2,1)', [id, JSON.stringify(doc)]);
            });
            created.push({ index, type: 'project', id, title: parsed.data.title });
        } catch (err) {
            failed.push({ index, reason: err instanceof Error ? err.message : '导入失败' });
        }
    }

    for (const [index, item] of body.assets.entries()) {
        const parsed = importAssetSchema.safeParse(item);
        if (!parsed.success) {
            failed.push({ index, reason: parsed.error.issues[0].message });
            continue;
        }
        try {
            const id = await pickId(parsed.data.id);
            await query(
                `INSERT INTO assets (id, workspace_id, owner_id, kind, title, cover_url, tags, source, note, storage_key, bytes, mime_type, width, height, visibility)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                [
                    id,
                    ctx.workspace.id,
                    ctx.member.user_id,
                    parsed.data.kind,
                    parsed.data.title,
                    parsed.data.coverUrl ?? null,
                    parsed.data.tags,
                    parsed.data.source ?? null,
                    parsed.data.note ?? null,
                    parsed.data.storageKey ?? null,
                    parsed.data.bytes ?? null,
                    parsed.data.mimeType ?? null,
                    parsed.data.width ?? null,
                    parsed.data.height ?? null,
                    parsed.data.visibility,
                ],
            );
            created.push({ index, type: 'asset', id, title: parsed.data.title });
        } catch (err) {
            failed.push({ index, reason: err instanceof Error ? err.message : '导入失败' });
        }
    }

    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'workspace.import',
        targetType: 'workspace',
        targetId: ctx.workspace.id,
        diff: { created: created.length, failed: failed.length },
    });
    ok(res, { created, failed });
});
