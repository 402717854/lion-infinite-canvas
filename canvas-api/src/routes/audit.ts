import { Router } from 'express';
import { query } from '../db.js';
import { requireWorkspace } from '../auth/session.js';
import { fail, ok, parse } from '../lib/http.js';
import { z } from 'zod';

export const auditRouter = Router();

const auditItem = (row: {
    id: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    result: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_ip: string | null;
    created_at: Date;
    diff: unknown;
}) => ({
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    actorId: row.actor_id,
    actorName: row.actor_name,
    ip: row.actor_ip,
    createdAt: row.created_at,
    diff: row.diff,
});

auditRouter.get('/:id/audit', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'audit.read');
    const params = parse(
        z.object({
            action: z.string().max(100).optional(),
            actorId: z.string().max(64).optional(),
            from: z.string().datetime({ offset: true }).optional(),
            to: z.string().datetime({ offset: true }).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            cursor: z.string().max(64).optional(),
        }),
        req.query,
    );

    const where: string[] = ['workspace_id = $1'];
    const values: unknown[] = [ctx.workspace.id];
    if (params.action) {
        values.push(params.action);
        where.push(`action = $${values.length}`);
    }
    if (params.actorId) {
        values.push(params.actorId);
        where.push(`actor_id = $${values.length}`);
    }
    if (params.from) {
        values.push(params.from);
        where.push(`created_at >= $${values.length}::timestamptz`);
    }
    if (params.to) {
        values.push(params.to);
        where.push(`created_at <= $${values.length}::timestamptz`);
    }
    if (params.cursor) {
        values.push(params.cursor);
        where.push(`id < $${values.length}`);
    }
    values.push(params.limit + 1);

    const rows = await query<{
        id: string;
        action: string;
        target_type: string | null;
        target_id: string | null;
        result: string;
        actor_id: string | null;
        actor_name: string | null;
        actor_ip: string | null;
        created_at: Date;
        diff: unknown;
    }>(
        `SELECT id, action, target_type, target_id, result, actor_id, actor_name, actor_ip, created_at, diff
         FROM audit_logs WHERE ${where.join(' AND ')}
         ORDER BY id DESC LIMIT $${values.length}`,
        values,
    );

    const hasMore = rows.length > params.limit;
    const items = (hasMore ? rows.slice(0, params.limit) : rows).map((row) => auditItem(row));
    ok(res, { items, nextCursor: hasMore ? items[items.length - 1].id : null });
});

// 显式拒绝任何修改审计的入口，保证只追加。
auditRouter.all('/:id/audit', (_req, _res) => {
    throw fail(405, 'METHOD_NOT_ALLOWED', '审计日志只允许读取');
});
