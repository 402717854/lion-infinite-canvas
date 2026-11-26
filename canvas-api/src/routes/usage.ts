import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireWorkspace } from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok, parse } from '../lib/http.js';
import {
    addDays,
    countersFor,
    isDayString,
    periodBounds,
    workspaceTimeZone,
    zonedDayStart,
    type GrantRow,
} from '../lib/models.js';

export const usageRouter = Router();

const GROUP_BY = ['day', 'user', 'model', 'channel'] as const;
const MAX_ROWS = 100_000;

const usageSchema = z.object({
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    groupBy: z.enum(GROUP_BY).default('day'),
    userId: z.string().trim().optional(),
    modelId: z.string().trim().optional(),
    capability: z.string().trim().optional(),
    entry: z.string().trim().optional(),
});

interface UsageRow {
    created_at: Date;
    user_id: string;
    channel_id: string | null;
    model_pk: string | null;
    model_id: string;
    capability: string;
    entry: string;
    status: string;
    error_code: string | null;
    latency_ms: number | null;
    cost_micros: string;
    display_name: string;
    role_key: string;
    channel_name: string | null;
}

function resolveRange(input: z.infer<typeof usageSchema>, timeZone: string) {
    const bounds = periodBounds(timeZone);
    const to = input.to || bounds.day;
    const from = input.from || addDays(to, -6);
    if (!isDayString(from) || !isDayString(to)) throw fail(400, 'INVALID_PARAM', '日期格式应为 YYYY-MM-DD');
    if (from > to) throw fail(400, 'INVALID_PARAM', '开始日期不能晚于结束日期');
    const spanDays = Math.round((zonedDayStart(timeZone, to).getTime() - zonedDayStart(timeZone, from).getTime()) / 86_400_000) + 1;
    if (spanDays > 366) throw fail(400, 'INVALID_PARAM', '时间范围最长 366 天');
    return { from, to, fromAt: zonedDayStart(timeZone, from), toAt: zonedDayStart(timeZone, addDays(to, 1)) };
}

const BASE_SELECT = `
    SELECT r.created_at, r.user_id, r.channel_id, r.model_pk, r.model_id, r.capability, r.entry,
           r.status, r.error_code, r.latency_ms, r.cost_micros,
           COALESCE(u.display_name, r.user_id) AS display_name,
           COALESCE(wm.role_key, '') AS role_key,
           c.name AS channel_name
    FROM usage_records r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = r.user_id
    LEFT JOIN channels c ON c.id = r.channel_id
    WHERE r.workspace_id = $1 AND r.created_at >= $2 AND r.created_at < $3`;

function whereClause(input: z.infer<typeof usageSchema>, params: unknown[]) {
    let sql = '';
    if (input.userId) {
        params.push(input.userId);
        sql += ` AND r.user_id = $${params.length}`;
    }
    if (input.modelId) {
        params.push(input.modelId);
        sql += ` AND r.model_id = $${params.length}`;
    }
    if (input.capability) {
        params.push(input.capability);
        sql += ` AND r.capability = $${params.length}`;
    }
    if (input.entry) {
        params.push(input.entry);
        sql += ` AND r.entry = $${params.length}`;
    }
    return sql;
}

usageRouter.get('/:id/usage', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'usage.read');
    const body = parse(usageSchema, req.query);
    const timeZone = workspaceTimeZone(ctx.workspace);
    const range = resolveRange(body, timeZone);
    const params: unknown[] = [ctx.workspace.id, range.fromAt, range.toAt];
    const where = whereClause(body, params);
    const rows = await query<UsageRow>(`${BASE_SELECT}${where} ORDER BY r.created_at DESC`, params);

    const totals = { calls: 0, succeeded: 0, failed: 0, avgLatencyMs: 0, costMicros: 0 };
    let latencySum = 0;
    let latencyCount = 0;
    const seriesMap = new Map<
        string,
        { key: string; calls: number; succeeded: number; failed: number; costMicros: number; capabilities: Record<string, number> }
    >();
    for (const row of rows) {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
            row.created_at,
        );
        const cost = Number(row.cost_micros);
        totals.calls += 1;
        totals.costMicros += cost;
        if (row.status === 'succeeded') {
            totals.succeeded += 1;
            if (typeof row.latency_ms === 'number') {
                latencySum += row.latency_ms;
                latencyCount += 1;
            }
        } else {
            totals.failed += 1;
        }
        const current = seriesMap.get(day) ?? {
            key: day,
            calls: 0,
            succeeded: 0,
            failed: 0,
            costMicros: 0,
            capabilities: {},
        };
        current.calls += 1;
        current.costMicros += cost;
        if (row.status === 'succeeded') current.succeeded += 1;
        else current.failed += 1;
        current.capabilities[row.capability] = (current.capabilities[row.capability] ?? 0) + 1;
        seriesMap.set(day, current);
    }
    totals.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;

    const groups = new Map<
        string,
        { key: string; name: string; roleKey?: string; calls: number; failed: number; latencySum: number; latencyCount: number; costMicros: number }
    >();
    const groupKey = (row: UsageRow) => {
        if (body.groupBy === 'user') return row.user_id;
        if (body.groupBy === 'model') return row.model_id;
        if (body.groupBy === 'channel') return row.channel_id ?? '';
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
            row.created_at,
        );
    };
    for (const row of rows) {
        const key = groupKey(row);
        const current =
            groups.get(key) ??
            {
                key,
                name:
                    body.groupBy === 'user'
                        ? row.display_name
                        : body.groupBy === 'model'
                          ? row.model_id
                          : body.groupBy === 'channel'
                            ? (row.channel_name ?? row.channel_id ?? '未关联渠道')
                            : key,
                roleKey: body.groupBy === 'user' ? row.role_key : undefined,
                calls: 0,
                failed: 0,
                latencySum: 0,
                latencyCount: 0,
                costMicros: 0,
            };
        current.calls += 1;
        current.costMicros += Number(row.cost_micros);
        if (row.status === 'succeeded') {
            if (typeof row.latency_ms === 'number') {
                current.latencySum += row.latency_ms;
                current.latencyCount += 1;
            }
        } else {
            current.failed += 1;
        }
        groups.set(key, current);
    }

    const payloadRows: Array<Record<string, unknown>> = [...groups.values()]
        .sort((a, b) => b.calls - a.calls)
        .map((group) => ({
            key: group.key,
            name: group.name,
            roleKey: group.roleKey,
            calls: group.calls,
            failed: group.failed,
            avgLatencyMs: group.latencyCount > 0 ? Math.round(group.latencySum / group.latencyCount) : 0,
            costMicros: group.costMicros,
        }));

    if (body.groupBy === 'user') {
        const quota = await memberDailyQuota(ctx.workspace.id, payloadRows.map((row) => String(row.key)), timeZone);
        for (const row of payloadRows) {
            const quotaRow = quota.get(String(row.key));
            row.dailyLimit = quotaRow?.limit ?? null;
            row.usedToday = quotaRow?.used ?? null;
        }
    }

    ok(res, {
        range: { from: range.from, to: range.to, timeZone },
        totals,
        series: [...seriesMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
        rows: payloadRows,
    });
});

/** 成员的生效日额度：按模型逐个取 member > role > workspace 的授权，额度与今日计数一起累加。 */
async function memberDailyQuota(workspaceId: string, userIds: string[], timeZone: string) {
    const result = new Map<string, { limit: number | null; used: number | null }>();
    if (userIds.length === 0) return result;
    const [models, grants, members] = await Promise.all([
        query<{ id: string }>('SELECT id FROM models WHERE workspace_id = $1 AND enabled', [workspaceId]),
        query<GrantRow>('SELECT * FROM model_grants WHERE workspace_id = $1 AND enabled', [workspaceId]),
        query<{ user_id: string; role_key: string }>('SELECT user_id, role_key FROM workspace_members WHERE workspace_id = $1', [
            workspaceId,
        ]),
    ]);
    const roleOf = new Map(members.map((row) => [row.user_id, row.role_key]));
    const counters = await countersFor(
        grants.map((grant) => grant.id),
        timeZone,
    );
    for (const userId of userIds) {
        const roleKey = roleOf.get(userId) ?? '';
        let limit = 0;
        let used = 0;
        let limited = false;
        for (const model of models) {
            const pick = (type: string, id: string) =>
                grants.find((grant) => grant.model_id === model.id && grant.subject_type === type && grant.subject_id === id);
            const grant = pick('member', userId) ?? pick('role', roleKey) ?? pick('workspace', '');
            if (!grant) continue;
            if (grant.daily_limit !== null) {
                limit += grant.daily_limit;
                limited = true;
            }
            used += counters.get(grant.id)?.day ?? 0;
        }
        result.set(userId, { limit: limited ? limit : null, used: limited ? used : null });
    }
    return result;
}

usageRouter.get('/:id/usage/export.csv', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'usage.export');
    const body = parse(usageSchema, req.query);
    const timeZone = workspaceTimeZone(ctx.workspace);
    const range = resolveRange(body, timeZone);
    const params: unknown[] = [ctx.workspace.id, range.fromAt, range.toAt];
    const where = whereClause(body, params);
    const countRow = await query<{ total: string }>(
        `SELECT count(*) AS total FROM usage_records r WHERE r.workspace_id = $1 AND r.created_at >= $2 AND r.created_at < $3${where}`,
        params,
    );
    const total = Number(countRow[0]?.total ?? 0);
    if (total > MAX_ROWS) throw fail(400, 'INVALID_PARAM', '数据量超过 10 万行，请缩小时间范围');
    const rows = await query<UsageRow>(`${BASE_SELECT}${where} ORDER BY r.created_at ASC`, params);
    const header = ['时间', '成员', '角色', '渠道', '模型', '能力', '入口', '状态', '耗时ms', '估算费用(元)', '错误码'];
    const lines = [header.join(',')];
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    for (const row of rows) {
        lines.push(
            [
                formatter.format(row.created_at).replace(',', ' '),
                row.display_name,
                row.role_key,
                row.channel_name ?? '',
                row.model_id,
                row.capability,
                row.entry,
                row.status === 'succeeded' ? '成功' : '失败',
                row.latency_ms === null ? '' : String(row.latency_ms),
                (Number(row.cost_micros) / 1_000_000).toFixed(4),
                row.error_code ?? '',
            ]
                .map(escape)
                .join(','),
        );
    }
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'usage.export',
        targetType: 'workspace',
        targetId: ctx.workspace.id,
        diff: { from: range.from, to: range.to, rows: rows.length },
    });
    const filename = `usage-${range.from}_${range.to}.csv`;
    res.status(200);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    res.send(`\uFEFF${lines.join('\r\n')}`);
});
