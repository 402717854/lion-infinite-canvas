import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { requireWorkspace } from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok, parse } from '../lib/http.js';
import {
    CAPABILITIES,
    ENTRIES,
    countersFor,
    guessCapability,
    modelValue,
    parseModelValue,
    periodBounds,
    workspaceTimeZone,
    type ChannelRow,
    type GrantRow,
    type ModelRow,
    type SubjectType,
} from '../lib/models.js';
import { BUILTIN_ROLE_KEYS, ROLES, roleMeta } from '../permissions.js';

export const modelsRouter = Router();

const capabilitySchema = z.enum(CAPABILITIES);
const entriesSchema = z.array(z.enum(ENTRIES)).max(ENTRIES.length);
const paramSpec = z.object({ options: z.array(z.string()).max(40), default: z.string().max(40) }).strict();
const paramsSchema = z.record(z.record(paramSpec)).default({});
const pricingSchema = z
    .object({
        unit: z.literal('call').default('call'),
        amount: z.number().min(0).max(100000).default(0),
        currency: z.string().trim().min(1).max(8).default('CNY'),
    })
    .default({ unit: 'call', amount: 0, currency: 'CNY' });

const createSchema = z.object({
    channelId: z.string().trim().min(1),
    modelId: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(80).optional(),
    capabilities: z.array(capabilitySchema).min(1).max(4).optional(),
    params: paramsSchema.optional(),
    pricing: pricingSchema.optional(),
    enabled: z.boolean().default(true),
    note: z.string().trim().max(200).nullable().optional(),
});

const patchSchema = z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    capabilities: z.array(capabilitySchema).min(1).max(4).optional(),
    params: paramsSchema.optional(),
    pricing: pricingSchema.optional(),
    enabled: z.boolean().optional(),
    note: z.string().trim().max(200).nullable().optional(),
});

const grantItemSchema = z.object({
    subjectType: z.enum(['workspace', 'role', 'member']),
    subjectId: z.string().trim().max(60).default(''),
    visible: z.boolean().default(true),
    entries: entriesSchema.default([...ENTRIES]),
    dailyLimit: z.number().int().min(1).max(1_000_000).nullable().default(null),
    monthlyLimit: z.number().int().min(1).max(10_000_000).nullable().default(null),
});

const grantsSchema = z.object({
    modelId: z.string().trim().min(1),
    items: z.array(grantItemSchema).max(500),
});

const bindingsSchema = z.object({
    image: z.string().trim().nullable().optional(),
    video: z.string().trim().nullable().optional(),
    text: z.string().trim().nullable().optional(),
    audio: z.string().trim().nullable().optional(),
});

interface ModelWithChannel extends ModelRow {
    channel_name: string;
    channel_enabled: boolean;
}

function modelPayload(row: ModelWithChannel, grants: GrantRow[], todayCalls: number) {
    return {
        id: row.id,
        channelId: row.channel_id,
        channelName: row.channel_name,
        modelId: row.model_id,
        value: modelValue(row.channel_id, row.model_id),
        displayName: row.display_name,
        capabilities: row.capabilities,
        params: row.params,
        pricing: row.pricing,
        enabled: row.enabled,
        channelEnabled: row.channel_enabled,
        note: row.note,
        grants: grants.map((grant) => ({
            subjectType: grant.subject_type,
            subjectId: grant.subject_id,
            visible: grant.visible,
            entries: grant.entries,
            dailyLimit: grant.daily_limit,
            monthlyLimit: grant.monthly_limit,
        })),
        todayCalls,
    };
}

async function modelRows(workspaceId: string): Promise<ModelWithChannel[]> {
    return query<ModelWithChannel>(
        `SELECT m.*, c.name AS channel_name, c.enabled AS channel_enabled
         FROM models m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.workspace_id = $1 AND c.deleted_at IS NULL
         ORDER BY c.created_at, m.created_at`,
        [workspaceId],
    );
}

async function workspaceModel(workspaceId: string, modelPk: string): Promise<ModelRow> {
    const row = await one<ModelRow>('SELECT * FROM models WHERE id = $1 AND workspace_id = $2', [modelPk, workspaceId]);
    if (!row) throw fail(404, 'NOT_FOUND', '模型不存在');
    return row;
}

// 放在 /models/:mid 之前，避免 available 被当成模型 id。
modelsRouter.get('/:id/models/available', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.use');
    const bypass = ctx.roleKey === 'owner' || ctx.roleKey === 'admin';
    const timeZone = workspaceTimeZone(ctx.workspace);

    const [channels, models, grants, bindings] = await Promise.all([
        query<ChannelRow>('SELECT * FROM channels WHERE workspace_id = $1 AND deleted_at IS NULL AND enabled ORDER BY created_at', [
            ctx.workspace.id,
        ]),
        query<ModelRow>('SELECT * FROM models WHERE workspace_id = $1 AND enabled ORDER BY created_at', [ctx.workspace.id]),
        query<GrantRow>('SELECT * FROM model_grants WHERE workspace_id = $1 AND enabled', [ctx.workspace.id]),
        query<{ capability: string; model_id: string }>('SELECT capability, model_id FROM model_bindings WHERE workspace_id = $1', [
            ctx.workspace.id,
        ]),
    ]);

    const channelMap = new Map(channels.map((row) => [row.id, row]));
    const modelById = new Map(models.map((row) => [row.id, row]));
    const pickGrant = (model: ModelRow): GrantRow | undefined => {
        const find = (type: SubjectType, id: string) =>
            grants.find((row) => row.model_id === model.id && row.subject_type === type && row.subject_id === id);
        return find('member', ctx.member.user_id) ?? find('role', ctx.roleKey) ?? find('workspace', '');
    };

    const visible: Array<{ model: ModelRow; grant?: GrantRow }> = [];
    for (const model of models) {
        if (!channelMap.has(model.channel_id)) continue;
        const grant = pickGrant(model);
        if (!bypass && (!grant || !grant.visible)) continue;
        visible.push({ model, grant });
    }

    const grantIds = visible.map((item) => item.grant?.id).filter((id): id is string => Boolean(id));
    const counters = await countersFor(grantIds, timeZone);
    const bounds = periodBounds(timeZone);

    const channelPayloads = channels
        .map((channel) => ({
            id: channel.id,
            name: channel.name,
            apiFormat: channel.api_format,
            models: visible
                .filter((item) => item.model.channel_id === channel.id)
                .map((item) => ({
                    name: item.model.model_id,
                    displayName: item.model.display_name,
                    value: modelValue(item.model.channel_id, item.model.model_id),
                    capabilities: item.model.capabilities,
                    params: item.model.params,
                    pricing: item.model.pricing,
                })),
        }))
        .filter((channel) => channel.models.length > 0);

    const grantsPayload: Record<string, { visible: boolean; entries: string[] }> = {};
    const quota: Array<{
        model: string;
        daily: { limit: number | null; used: number; resetsAt: string };
        monthly: { limit: number | null; used: number; resetsAt: string };
    }> = [];

    for (const { model, grant } of visible) {
        const value = modelValue(model.channel_id, model.model_id);
        const entries = bypass ? [...ENTRIES] : (grant?.entries ?? []);
        grantsPayload[value] = { visible: true, entries };
        if (grant && (grant.daily_limit !== null || grant.monthly_limit !== null)) {
            const used = counters.get(grant.id) ?? { day: 0, month: 0 };
            quota.push({
                model: value,
                daily: { limit: grant.daily_limit, used: used.day, resetsAt: bounds.dayResetAt.toISOString() },
                monthly: { limit: grant.monthly_limit, used: used.month, resetsAt: bounds.monthResetAt.toISOString() },
            });
        }
    }

    const bindingsPayload: Record<string, string | null> = { image: null, video: null, text: null, audio: null };
    for (const row of bindings) {
        const model = modelById.get(row.model_id);
        if (!model) continue;
        if (!visible.some((item) => item.model.id === model.id)) continue;
        bindingsPayload[row.capability] = modelValue(model.channel_id, model.model_id);
    }

    ok(res, { channels: channelPayloads, bindings: bindingsPayload, grants: grantsPayload, quota });
});

modelsRouter.get('/:id/models', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.read');
    const rows = await modelRows(ctx.workspace.id);
    const channelFilter = typeof req.query.channelId === 'string' ? req.query.channelId : '';
    const capabilityFilter = typeof req.query.capability === 'string' ? req.query.capability : '';
    const filtered = rows.filter(
        (row) =>
            (!channelFilter || row.channel_id === channelFilter) &&
            (!capabilityFilter || row.capabilities.includes(capabilityFilter)),
    );
    const [grants, usage] = await Promise.all([
        query<GrantRow>('SELECT * FROM model_grants WHERE workspace_id = $1 AND enabled', [ctx.workspace.id]),
        (async () => {
            const bounds = periodBounds(workspaceTimeZone(ctx.workspace));
            return query<{ model_pk: string; calls: string }>(
                `SELECT model_pk, count(*) AS calls FROM usage_records
                 WHERE workspace_id = $1 AND created_at >= $2 AND model_pk IS NOT NULL
                 GROUP BY model_pk`,
                [ctx.workspace.id, bounds.dayStartAt],
            );
        })(),
    ]);
    const callMap = new Map(usage.map((row) => [row.model_pk, Number(row.calls)]));
    ok(
        res,
        filtered.map((row) =>
            modelPayload(
                row,
                grants.filter((grant) => grant.model_id === row.id),
                callMap.get(row.id) ?? 0,
            ),
        ),
    );
});

modelsRouter.post('/:id/models', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.entry.manage');
    const body = parse(createSchema, req.body);
    const channel = await one<ChannelRow>(
        'SELECT * FROM channels WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL',
        [body.channelId, ctx.workspace.id],
    );
    if (!channel) throw fail(400, 'INVALID_PARAM', '渠道不存在');
    const dup = await one<{ id: string }>('SELECT id FROM models WHERE channel_id = $1 AND model_id = $2', [
        channel.id,
        body.modelId,
    ]);
    if (dup) throw fail(400, 'INVALID_PARAM', '该渠道下已存在同名模型');
    const row = await one<ModelRow>(
        `INSERT INTO models (id, workspace_id, channel_id, model_id, display_name, capabilities, params, pricing, enabled, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
            nanoid(),
            ctx.workspace.id,
            channel.id,
            body.modelId,
            body.displayName ?? body.modelId,
            body.capabilities ?? [guessCapability(body.modelId)],
            body.params ?? {},
            body.pricing ?? { unit: 'call', amount: 0, currency: 'CNY' },
            body.enabled,
            body.note ?? null,
        ],
    );
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'model.create',
        targetType: 'model',
        targetId: row!.id,
        diff: { modelId: body.modelId, channelId: channel.id },
    });
    ok(res, modelPayload({ ...row!, channel_name: channel.name, channel_enabled: channel.enabled }, [], 0), 201);
});

modelsRouter.patch('/:id/models/:mid', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.entry.manage');
    const current = await workspaceModel(ctx.workspace.id, req.params.mid);
    const body = parse(patchSchema, req.body);
    const row = await one<ModelRow>(
        `UPDATE models SET
            display_name = COALESCE($3, display_name),
            capabilities = COALESCE($4, capabilities),
            params = COALESCE($5, params),
            pricing = COALESCE($6, pricing),
            enabled = COALESCE($7, enabled),
            note = $8,
            updated_at = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING *`,
        [
            current.id,
            ctx.workspace.id,
            body.displayName ?? null,
            body.capabilities ?? null,
            body.params ? JSON.stringify(body.params) : null,
            body.pricing ? JSON.stringify(body.pricing) : null,
            body.enabled ?? null,
            body.note === undefined ? current.note : body.note,
        ],
    );
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'model.update',
        targetType: 'model',
        targetId: current.id,
        diff: { displayName: body.displayName ?? null, enabled: body.enabled ?? null },
    });
    const channel = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [current.channel_id]);
    ok(
        res,
        modelPayload(
            { ...row!, channel_name: channel?.name ?? '', channel_enabled: channel?.enabled ?? false },
            await query<GrantRow>('SELECT * FROM model_grants WHERE model_id = $1 AND enabled', [current.id]),
            0,
        ),
    );
});

modelsRouter.delete('/:id/models/:mid', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.entry.manage');
    const current = await workspaceModel(ctx.workspace.id, req.params.mid);
    await tx(async (client) => {
        await client.query('DELETE FROM model_grants WHERE model_id = $1', [current.id]);
        await client.query('DELETE FROM model_bindings WHERE model_id = $1', [current.id]);
        await client.query('DELETE FROM models WHERE id = $1', [current.id]);
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'model.delete',
        targetType: 'model',
        targetId: current.id,
        diff: { modelId: current.model_id },
    });
    ok(res, { id: current.id });
});

modelsRouter.get('/:id/model-grants', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.read');
    const modelPk = typeof req.query.modelId === 'string' ? req.query.modelId : '';
    if (!modelPk) throw fail(400, 'INVALID_PARAM', '缺少 modelId');
    const model = await workspaceModel(ctx.workspace.id, modelPk);
    const timeZone = workspaceTimeZone(ctx.workspace);
    const grants = await query<GrantRow>('SELECT * FROM model_grants WHERE model_id = $1 AND enabled', [model.id]);
    const [members, quota] = await Promise.all([
        query<{ user_id: string; display_name: string; role_key: string }>(
            `SELECT wm.user_id, u.display_name, wm.role_key
             FROM workspace_members wm JOIN users u ON u.id = wm.user_id
             WHERE wm.workspace_id = $1 AND wm.status = 'active'
             ORDER BY wm.joined_at`,
            [ctx.workspace.id],
        ),
        countersFor(
            grants.map((grant) => grant.id),
            timeZone,
        ),
    ]);
    const bounds = periodBounds(timeZone);
    ok(res, {
        model: {
            id: model.id,
            modelId: model.model_id,
            displayName: model.display_name,
            value: modelValue(model.channel_id, model.model_id),
        },
        roles: ROLES.map((role) => ({ key: role.key, name: role.name })),
        members: members.map((row) => ({
            id: row.user_id,
            displayName: row.display_name,
            roleKey: row.role_key,
            roleName: roleMeta(row.role_key)?.name ?? row.role_key,
        })),
        resetsAt: { daily: bounds.dayResetAt.toISOString(), monthly: bounds.monthResetAt.toISOString() },
        items: grants.map((grant) => ({
            id: grant.id,
            subjectType: grant.subject_type,
            subjectId: grant.subject_id,
            visible: grant.visible,
            entries: grant.entries,
            dailyLimit: grant.daily_limit,
            monthlyLimit: grant.monthly_limit,
            todayUsed: quota.get(grant.id)?.day ?? 0,
            monthUsed: quota.get(grant.id)?.month ?? 0,
        })),
    });
});

modelsRouter.put('/:id/model-grants', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.grant.manage');
    const body = parse(grantsSchema, req.body);
    const model = await workspaceModel(ctx.workspace.id, body.modelId);
    const roleKeys = new Set(BUILTIN_ROLE_KEYS);
    const memberIds = new Set(
        (
            await query<{ user_id: string }>("SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND status = 'active'", [
                ctx.workspace.id,
            ])
        ).map((row) => row.user_id),
    );
    const seen = new Set<string>();
    for (const item of body.items) {
        const key = `${item.subjectType}:${item.subjectId}`;
        if (seen.has(key)) throw fail(400, 'INVALID_PARAM', '授权对象重复');
        seen.add(key);
        if (item.subjectType === 'role' && !roleKeys.has(item.subjectId)) {
            throw fail(400, 'INVALID_PARAM', `未知角色 ${item.subjectId}`);
        }
        if (item.subjectType === 'member' && !memberIds.has(item.subjectId)) {
            throw fail(400, 'INVALID_PARAM', '授权成员不在该空间');
        }
        if (item.subjectType === 'workspace' && item.subjectId !== '') {
            throw fail(400, 'INVALID_PARAM', 'workspace 授权不需要 subjectId');
        }
    }
    await tx(async (client) => {
        await client.query('DELETE FROM model_grants WHERE model_id = $1', [model.id]);
        for (const item of body.items) {
            await client.query(
                `INSERT INTO model_grants
                    (id, workspace_id, model_id, subject_type, subject_id, visible, entries, daily_limit, monthly_limit, updated_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [
                    nanoid(),
                    ctx.workspace.id,
                    model.id,
                    item.subjectType,
                    item.subjectId,
                    item.visible,
                    item.entries,
                    item.dailyLimit,
                    item.monthlyLimit,
                    ctx.member.user_id,
                ],
            );
        }
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'grant.update',
        targetType: 'model',
        targetId: model.id,
        diff: { items: body.items.length },
    });
    ok(res, { modelId: model.id, items: body.items.length });
});

modelsRouter.get('/:id/model-bindings', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.read');
    const rows = await query<{ capability: string; model_pk: string; model_name: string; channel_id: string; channel_name: string }>(
        `SELECT b.capability, b.model_id AS model_pk, m.model_id AS model_name, m.channel_id, c.name AS channel_name
         FROM model_bindings b
         JOIN models m ON m.id = b.model_id
         JOIN channels c ON c.id = m.channel_id
         WHERE b.workspace_id = $1`,
        [ctx.workspace.id],
    );
    const payload: Record<string, { value: string; displayName: string } | null> = {
        image: null,
        video: null,
        text: null,
        audio: null,
    };
    for (const row of rows) {
        payload[row.capability] = {
            value: modelValue(row.channel_id, row.model_name),
            displayName: `${row.model_name}（${row.channel_name}）`,
        };
    }
    ok(res, payload);
});

modelsRouter.put('/:id/model-bindings', async (req, res) => {
    const ctx = await requireWorkspace(req, req.params.id, 'model.grant.manage');
    const body = parse(bindingsSchema, req.body);
    const entries = Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '');
    for (const [capability, value] of entries) {
        const model = await workspaceModelForValue(ctx.workspace.id, value);
        const matched = model.capabilities.includes(capability);
        if (!matched) throw fail(400, 'INVALID_PARAM', `模型 ${value} 不支持 ${capability}`);
    }
    await tx(async (client) => {
        for (const capability of CAPABILITIES) {
            const value = body[capability];
            if (value === undefined) continue;
            if (!value) {
                await client.query('DELETE FROM model_bindings WHERE workspace_id = $1 AND capability = $2', [
                    ctx.workspace.id,
                    capability,
                ]);
                continue;
            }
            const model = await workspaceModelForValue(ctx.workspace.id, value);
            await client.query(
                `INSERT INTO model_bindings (workspace_id, capability, model_id, updated_by, updated_at)
                 VALUES ($1,$2,$3,$4,now())
                 ON CONFLICT (workspace_id, capability) DO UPDATE
                    SET model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
                [ctx.workspace.id, capability, model.id, ctx.member.user_id],
            );
        }
    });
    await writeAudit({
        workspaceId: ctx.workspace.id,
        actorId: ctx.member.user_id,
        actorName: ctx.member.display_name,
        actorIp: req.ip,
        action: 'binding.update',
        targetType: 'workspace',
        targetId: ctx.workspace.id,
        diff: Object.fromEntries(entries),
    });
    ok(res, Object.fromEntries(entries));
});

async function workspaceModelForValue(workspaceId: string, value: string): Promise<ModelRow> {
    const { channelId, modelId } = parseModelValue(value);
    const row = channelId
        ? await one<ModelRow>('SELECT * FROM models WHERE workspace_id = $1 AND channel_id = $2 AND model_id = $3', [
              workspaceId,
              channelId,
              modelId,
          ])
        : await one<ModelRow>('SELECT * FROM models WHERE workspace_id = $1 AND model_id = $2', [workspaceId, modelId]);
    if (!row) throw fail(400, 'INVALID_PARAM', '模型不存在');
    return row;
}
