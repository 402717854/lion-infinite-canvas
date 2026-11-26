import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireWorkspace } from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { encryptSecret, maskSecret } from '../lib/crypto.js';
import { fail, ok, parse } from '../lib/http.js';
import { guessCapability, periodBounds, workspaceTimeZone, type ChannelRow } from '../lib/models.js';
import { channelHeaders, readUpstreamFailure, upstreamError, upstreamFetch } from '../lib/upstream.js';

export const channelsRouter = Router();

const createSchema = z.object({
    name: z.string().trim().min(1, '渠道名称不能为空').max(40),
    baseUrl: z.string().trim().url('Base URL 格式不正确').max(300),
    apiKey: z.string().trim().min(8, 'API Key 至少 8 位').max(400),
    apiFormat: z.enum(['openai']).default('openai'),
    timeoutMs: z.number().int().min(5000).max(300000).default(60000),
    retry: z.number().int().min(0).max(2).default(1),
    enabled: z.boolean().default(true),
});

const patchSchema = z.object({
    name: z.string().trim().min(1, '渠道名称不能为空').max(40).optional(),
    baseUrl: z.string().trim().url('Base URL 格式不正确').max(300).optional(),
    apiKey: z.string().trim().min(8, 'API Key 至少 8 位').max(400).optional(),
    apiFormat: z.enum(['openai']).optional(),
    timeoutMs: z.number().int().min(5000).max(300000).optional(),
    retry: z.number().int().min(0).max(2).optional(),
    enabled: z.boolean().optional(),
});

const testSchema = z.object({
    baseUrl: z.string().trim().url('Base URL 格式不正确').max(300).optional(),
    apiKey: z.string().trim().min(8).max(400).optional(),
});

const importSchema = z.object({
    models: z
        .array(
            z.object({
                modelId: z.string().trim().min(1).max(120),
                displayName: z.string().trim().min(1).max(80).optional(),
                capabilities: z.array(z.enum(['image', 'video', 'text', 'audio'])).min(1).optional(),
            }),
        )
        .min(1, '请至少选择一个模型')
        .max(200),
});

interface ChannelStats {
    modelCount: number;
    todayCalls: number;
    lastOkAt: Date | null;
}

function channelPayload(row: ChannelRow, stats: ChannelStats) {
    return {
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        apiKeyMask: row.api_key_hint,
        apiFormat: row.api_format,
        timeoutMs: row.timeout_ms,
        retry: row.retry,
        enabled: row.enabled,
        modelCount: stats.modelCount,
        todayCalls: stats.todayCalls,
        lastOkAt: stats.lastOkAt ? stats.lastOkAt.toISOString() : null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

async function channelStats(workspaceId: string, dayStartAt: Date): Promise<Map<string, ChannelStats>> {
    const result = new Map<string, ChannelStats>();
    const counts = await query<{ channel_id: string; model_count: string }>(
        'SELECT channel_id, count(*) AS model_count FROM models WHERE workspace_id = $1 GROUP BY channel_id',
        [workspaceId],
    );
    for (const row of counts) {
        result.set(row.channel_id, { modelCount: Number(row.model_count), todayCalls: 0, lastOkAt: null });
    }
    const usage = await query<{ channel_id: string; calls: string; last_ok: Date | null }>(
        `SELECT channel_id, count(*) AS calls, max(created_at) FILTER (WHERE status = 'succeeded') AS last_ok
         FROM usage_records
         WHERE workspace_id = $1 AND created_at >= $2 AND channel_id IS NOT NULL
         GROUP BY channel_id`,
        [workspaceId, dayStartAt],
    );
    for (const row of usage) {
        const current = result.get(row.channel_id) ?? { modelCount: 0, todayCalls: 0, lastOkAt: null };
        current.todayCalls = Number(row.calls);
        current.lastOkAt = row.last_ok;
        result.set(row.channel_id, current);
    }
    return result;
}

async function workspaceChannel(workspaceId: string, channelId: string): Promise<ChannelRow> {
    const row = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [
        channelId,
        workspaceId,
    ]);
    if (!row) throw fail(404, 'NOT_FOUND', '渠道不存在');
    return row;
}

async function probeModels(channel: ChannelRow, headers = channelHeaders(channel)) {
    const startedAt = Date.now();
    const response = await upstreamFetch(channel, '/models', { method: 'GET', headers }, { retry: false });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
        const failure = await readUpstreamFailure(response);
        return { ok: false as const, status: response.status, latencyMs, summary: failure.summary };
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (Array.isArray(payload.data) ? payload.data : [])
        .map((item) => (typeof item?.id === 'string' ? item.id : null))
        .filter((id): id is string => Boolean(id));
    return { ok: true as const, status: response.status, latencyMs, ids };
}

channelsRouter.get('/:id/channels', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.read');
    const bounds = periodBounds(workspaceTimeZone(ctx.workspace));
    const [rows, stats] = await Promise.all([
        query<ChannelRow>('SELECT * FROM channels WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at', [
            ctx.workspace.id,
        ]),
        channelStats(ctx.workspace.id, bounds.dayStartAt),
    ]);
    ok(
        res,
        rows.map((row) => channelPayload(row, stats.get(row.id) ?? { modelCount: 0, todayCalls: 0, lastOkAt: null })),
    );
});

channelsRouter.post('/:id/channels', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.channel.manage');
    const body = parse(createSchema, req.body);
    const id = nanoid();
    const row = await one<ChannelRow>(
        `INSERT INTO channels (id, workspace_id, name, base_url, api_key_cipher, api_key_hint, api_format, timeout_ms, retry, enabled, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
            id,
            ctx.workspace.id,
            body.name,
            body.baseUrl,
            encryptSecret(body.apiKey),
            maskSecret(body.apiKey),
            body.apiFormat,
            body.timeoutMs,
            body.retry,
            body.enabled,
            ctx.member.user_id,
        ],
    );
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'channel.create',
        targetType: 'channel',
        targetId: id,
        diff: { name: body.name, baseUrl: body.baseUrl, apiFormat: body.apiFormat },
    });
    ok(res, channelPayload(row!, { modelCount: 0, todayCalls: 0, lastOkAt: null }), 201);
});

channelsRouter.patch('/:id/channels/:channelId', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.channel.manage');
    const current = await workspaceChannel(ctx.workspace.id, req.params.channelId);
    const body = parse(patchSchema, req.body);
    const row = await one<ChannelRow>(
        `UPDATE channels SET
            name = COALESCE($3, name),
            base_url = COALESCE($4, base_url),
            api_key_cipher = COALESCE($5, api_key_cipher),
            api_key_hint = COALESCE($6, api_key_hint),
            api_format = COALESCE($7, api_format),
            timeout_ms = COALESCE($8, timeout_ms),
            retry = COALESCE($9, retry),
            enabled = COALESCE($10, enabled),
            updated_at = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING *`,
        [
            current.id,
            ctx.workspace.id,
            body.name ?? null,
            body.baseUrl ?? null,
            body.apiKey ? encryptSecret(body.apiKey) : null,
            body.apiKey ? maskSecret(body.apiKey) : null,
            body.apiFormat ?? null,
            body.timeoutMs ?? null,
            body.retry ?? null,
            body.enabled ?? null,
        ],
    );
    if (body.apiKey) {
        await writeAudit({
            workspaceId: ctx.workspace.id,
            actorId: ctx.member.user_id,
            actorName: ctx.member.display_name,
            actorIp: req.ip,
            action: 'channel.key.rotate',
            targetType: 'channel',
            targetId: current.id,
            diff: { apiKeyMask: maskSecret(body.apiKey) },
        });
    }
    const changes = {
        name: body.name ?? null,
        baseUrl: body.baseUrl ?? null,
        apiFormat: body.apiFormat ?? null,
        timeoutMs: body.timeoutMs ?? null,
        retry: body.retry ?? null,
        enabled: body.enabled ?? null,
    };
    if (Object.values(changes).some((value) => value !== null)) {
        await writeAudit({
            workspaceId: ctx.workspace.id,
            actorId: ctx.member.user_id,
            actorName: ctx.member.display_name,
            actorIp: req.ip,
            action: 'channel.update',
            targetType: 'channel',
            targetId: current.id,
            diff: changes,
        });
    }
    const bounds = periodBounds(workspaceTimeZone(ctx.workspace));
    const stats = (await channelStats(ctx.workspace.id, bounds.dayStartAt)).get(current.id);
    ok(res, channelPayload(row!, stats ?? { modelCount: 0, todayCalls: 0, lastOkAt: null }));
});

channelsRouter.delete('/:id/channels/:channelId', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.channel.manage');
    const current = await workspaceChannel(ctx.workspace.id, req.params.channelId);
    await tx(async (client) => {
        await client.query(
            'DELETE FROM model_bindings WHERE model_id IN (SELECT id FROM models WHERE channel_id = $1)',
            [current.id],
        );
        await client.query('UPDATE models SET enabled = false, updated_at = now() WHERE channel_id = $1', [current.id]);
        await client.query('UPDATE channels SET deleted_at = now(), enabled = false WHERE id = $1', [current.id]);
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'channel.delete',
        targetType: 'channel',
        targetId: current.id,
        diff: { name: current.name },
    });
    ok(res, { id: current.id });
});

// 连通性测试：可用请求体覆盖 baseUrl / apiKey，支持保存前试。
channelsRouter.post('/:id/channels/:channelId/test', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.channel.manage');
    const channel = await workspaceChannel(ctx.workspace.id, req.params.channelId);
    const body = parse(testSchema, req.body ?? {});
    const probeChannel: ChannelRow = {
        ...channel,
        base_url: body.baseUrl ?? channel.base_url,
        api_key_cipher: body.apiKey ? encryptSecret(body.apiKey) : channel.api_key_cipher,
    };
    let result: { ok: boolean; status: number | null; latencyMs: number; modelCount: number; sample: string[]; error?: string };
    try {
        const probe = await probeModels(probeChannel);
        if (probe.ok) {
            result = {
                ok: true,
                status: probe.status,
                latencyMs: probe.latencyMs,
                modelCount: probe.ids.length,
                sample: probe.ids.slice(0, 5),
            };
        } else {
            result = {
                ok: false,
                status: probe.status,
                latencyMs: probe.latencyMs,
                modelCount: 0,
                sample: [],
                error: probe.summary,
            };
        }
    } catch (err) {
        const data = (err as { data?: { summary?: string } }).data;
        result = {
            ok: false,
            status: null,
            latencyMs: 0,
            modelCount: 0,
            sample: [],
            error: data?.summary ?? (err instanceof Error ? err.message : '未知错误'),
        };
    }
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'channel.test',
        targetType: 'channel',
        targetId: channel.id,
        result: result.ok ? 'success' : 'failure',
        diff: { status: result.status, modelCount: result.modelCount, error: result.error ?? null },
    });
    ok(res, result);
});

channelsRouter.get('/:id/channels/:channelId/models/upstream', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.entry.manage');
    const channel = await workspaceChannel(ctx.workspace.id, req.params.channelId);
    const probe = await probeModels(channel);
    if (!probe.ok) throw upstreamError({ status: probe.status, summary: probe.summary }, probe.status);
    const existing = new Set(
        (await query<{ model_id: string }>('SELECT model_id FROM models WHERE channel_id = $1', [channel.id])).map(
            (row) => row.model_id,
        ),
    );
    ok(res, { items: probe.ids.map((id) => ({ id, imported: existing.has(id) })) });
});

channelsRouter.post('/:id/channels/:channelId/models/import', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.entry.manage');
    const channel = await workspaceChannel(ctx.workspace.id, req.params.channelId);
    const body = parse(importSchema, req.body);
    const created = await tx(async (client) => {
        let count = 0;
        for (const item of body.models) {
            const capabilities = item.capabilities ?? [guessCapability(item.modelId)];
            const result = await client.query(
                `INSERT INTO models (id, workspace_id, channel_id, model_id, display_name, capabilities)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (channel_id, model_id) DO UPDATE
                    SET display_name = EXCLUDED.display_name, updated_at = now()
                 RETURNING (xmax = 0) AS inserted`,
                [nanoid(), ctx.workspace.id, channel.id, item.modelId, item.displayName ?? item.modelId, capabilities],
            );
            if (result.rows[0]?.inserted) count += 1;
        }
        return count;
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'model.import',
        targetType: 'channel',
        targetId: channel.id,
        diff: { requested: body.models.length, created },
    });
    ok(res, { created, skipped: body.models.length - created });
});
