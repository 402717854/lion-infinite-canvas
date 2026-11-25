import { Router, type Request } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { one, query } from '../db.js';
import { assertEmailVerified, getMembership, requireAuth, requireWorkspace, rolePermissions } from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok, parse } from '../lib/http.js';
import { signedUrl } from '../lib/storage.js';
import type { AssetRow, MemberRow, WorkspaceRow } from '../types.js';

export const workspaceAssetsRouter = Router();
export const assetsRouter = Router();

const assetPayload = (row: AssetRow) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    coverUrl: row.cover_url,
    tags: row.tags,
    source: row.source,
    note: row.note,
    storageKey: row.storage_key,
    bytes: row.bytes === null ? null : Number(row.bytes),
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerId: row.owner_id,
});

const assetFields = z.object({
    kind: z.enum(['text', 'image', 'video', 'audio']).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    coverUrl: z.string().max(2048).optional(),
    tags: z.array(z.string().max(60)).max(50).optional(),
    source: z.string().max(200).optional(),
    note: z.string().max(2000).optional(),
    storageKey: z.string().max(128).optional(),
    bytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().max(200).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    visibility: z.enum(['private', 'workspace']).optional(),
});

const COLUMNS: Record<string, string> = {
    kind: 'kind',
    title: 'title',
    coverUrl: 'cover_url',
    tags: 'tags',
    source: 'source',
    note: 'note',
    storageKey: 'storage_key',
    bytes: 'bytes',
    mimeType: 'mime_type',
    width: 'width',
    height: 'height',
    visibility: 'visibility',
};

interface AssetAccess {
    asset: AssetRow;
    workspace: WorkspaceRow;
    member: MemberRow;
    roleKey: string;
    permissions: string[];
}

async function assetAccess(req: Request, assetId: string): Promise<AssetAccess> {
    const auth = requireAuth(req);
    const asset = await one<AssetRow>('SELECT * FROM assets WHERE id = $1', [assetId]);
    if (!asset) throw fail(404, 'NOT_FOUND', '素材不存在或无权访问');
    const membership = await getMembership(asset.workspace_id, auth.user.id);
    if (!membership) throw fail(404, 'NOT_FOUND', '素材不存在或无权访问');
    assertEmailVerified(auth.user);
    if (asset.visibility === 'private' && asset.owner_id !== auth.user.id) {
        throw fail(404, 'NOT_FOUND', '素材不存在或无权访问');
    }
    const permissions = await rolePermissions(asset.workspace_id, membership.member.role_key);
    return {
        asset,
        workspace: membership.workspace,
        member: membership.member,
        roleKey: membership.member.role_key,
        permissions,
    };
}

function requirePerm(access: AssetAccess, permission: string): void {
    if (!access.permissions.includes(permission)) {
        throw fail(403, 'PERMISSION_DENIED', '缺少权限点：' + permission, { missingPermission: permission });
    }
}

workspaceAssetsRouter.get('/:id/assets', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'asset.read');
    const rows = await query<AssetRow>(
        `SELECT * FROM assets
         WHERE workspace_id = $1 AND (visibility = 'workspace' OR owner_id = $2)
         ORDER BY created_at DESC LIMIT 500`,
        [ctx.workspace.id, ctx.member.user_id],
    );
    ok(res, { items: rows.map((row) => assetPayload(row)) });
});

workspaceAssetsRouter.post('/:id/assets', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'asset.create');
    const body = parse(
        z.object({
            kind: z.enum(['text', 'image', 'video', 'audio']).default('image'),
            title: z.string().trim().min(1, '素材名称不能为空').max(200),
            coverUrl: z.string().max(2048).optional(),
            tags: z.array(z.string().max(60)).max(50).default([]),
            source: z.string().max(200).optional(),
            note: z.string().max(2000).optional(),
            storageKey: z.string().max(128).optional(),
            bytes: z.number().int().nonnegative().optional(),
            mimeType: z.string().max(200).optional(),
            width: z.number().int().positive().optional(),
            height: z.number().int().positive().optional(),
            visibility: z.enum(['private', 'workspace']).default('workspace'),
        }),
        req.body,
    );
    const id = nanoid();
    const coverUrl = body.coverUrl ?? (body.storageKey ? signedUrl(body.storageKey) : null);
    const rows = await query<AssetRow>(
        `INSERT INTO assets (id, workspace_id, owner_id, kind, title, cover_url, tags, source, note, storage_key, bytes, mime_type, width, height, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
            id,
            ctx.workspace.id,
            ctx.member.user_id,
            body.kind,
            body.title,
            coverUrl,
            body.tags,
            body.source ?? null,
            body.note ?? null,
            body.storageKey ?? null,
            body.bytes ?? null,
            body.mimeType ?? null,
            body.width ?? null,
            body.height ?? null,
            body.visibility,
        ],
    );
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'asset.create',
        targetType: 'asset',
        targetId: id,
        diff: { title: body.title, kind: body.kind },
    });
    ok(res, assetPayload(rows[0]), 201);
});

assetsRouter.patch('/:id', async (req, res) => {
    const access = await assetAccess(req, req.params.id);
    requirePerm(access, 'asset.update');
    const body = parse(assetFields, req.body);
    const entries = Object.entries(body).filter(([, value]) => value !== undefined);
    if (entries.length === 0) throw fail(400, 'INVALID_PARAM', '没有需要更新的字段');
    const sets: string[] = [];
    const values: unknown[] = [access.asset.id];
    for (const [field, value] of entries) {
        values.push(value);
        sets.push(`${COLUMNS[field]} = $${values.length}`);
    }
    const rows = await query<AssetRow>(`UPDATE assets SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, values);
    await writeAudit({
        workspaceId: access.asset.workspace_id,
        actorId: access.member.user_id,
        actorName: access.member.display_name,
        actorIp: req.ip,
        action: 'asset.update',
        targetType: 'asset',
        targetId: access.asset.id,
        diff: { fields: entries.map(([field]) => field) },
    });
    ok(res, assetPayload(rows[0]));
});

assetsRouter.delete('/:id', async (req, res) => {
    const access = await assetAccess(req, req.params.id);
    requirePerm(access, 'asset.delete');
    await query('DELETE FROM assets WHERE id = $1', [access.asset.id]);
    await writeAudit({
        workspaceId: access.asset.workspace_id,
        actorId: access.member.user_id,
        actorName: access.member.display_name,
        actorIp: req.ip,
        action: 'asset.delete',
        targetType: 'asset',
        targetId: access.asset.id,
        diff: { title: access.asset.title },
    });
    ok(res, { deleted: true });
});
