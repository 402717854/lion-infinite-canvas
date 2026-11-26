import { query, tx } from '../db.js';
import { fail, sortableId } from './http.js';
import type { WorkspaceRow } from '../types.js';

export const ENTRIES = ['canvas', 'image', 'video', 'assistant', 'agent', 'api'] as const;
export type Entry = (typeof ENTRIES)[number];

export const CAPABILITIES = ['image', 'video', 'text', 'audio'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface ChannelRow {
    id: string;
    workspace_id: string;
    name: string;
    base_url: string;
    api_key_cipher: string;
    api_key_hint: string;
    api_format: string;
    headers_cipher: string | null;
    timeout_ms: number;
    retry: number;
    enabled: boolean;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface ModelRow {
    id: string;
    workspace_id: string;
    channel_id: string;
    model_id: string;
    display_name: string;
    capabilities: string[];
    params: Record<string, unknown>;
    pricing: Record<string, unknown>;
    enabled: boolean;
    note: string | null;
    created_at: Date;
    updated_at: Date;
}

export type SubjectType = 'workspace' | 'role' | 'member';

export interface GrantRow {
    id: string;
    workspace_id: string;
    model_id: string;
    subject_type: SubjectType;
    subject_id: string;
    visible: boolean;
    entries: string[];
    daily_limit: number | null;
    monthly_limit: number | null;
    enabled: boolean;
    updated_by: string | null;
    created_at: Date;
    updated_at: Date;
}

export const modelValue = (channelId: string, modelId: string): string => `${channelId}::${modelId}`;

/** 解析 `channelId::model`；没有前缀时视为裸模型名。 */
export function parseModelValue(raw: string): { channelId: string | null; modelId: string } {
    const value = raw.trim();
    const at = value.indexOf('::');
    if (at < 0) return { channelId: null, modelId: value };
    return { channelId: value.slice(0, at).trim() || null, modelId: value.slice(at + 2).trim() };
}

export function isEntry(value: string): value is Entry {
    return (ENTRIES as readonly string[]).includes(value);
}

export interface ResolvedModel {
    channel: ChannelRow;
    model: ModelRow;
}

/**
 * 解析并校验模型：先按 `channelId::modelId` 命中，渠道不在本空间时退回按裸模型名唯一匹配，
 * 这样本地模式留下的旧画布节点不需要迁移。
 */
export async function resolveModel(workspaceId: string, raw: string): Promise<ResolvedModel> {
    const { channelId, modelId } = parseModelValue(raw || '');
    if (!modelId) throw fail(400, 'INVALID_PARAM', '缺少模型标识');

    const [models, channels] = await Promise.all([
        query<ModelRow>('SELECT * FROM models WHERE workspace_id = $1', [workspaceId]),
        query<ChannelRow>('SELECT * FROM channels WHERE workspace_id = $1 AND deleted_at IS NULL', [workspaceId]),
    ]);
    const channelMap = new Map(channels.map((row) => [row.id, row]));
    const pair = (model: ModelRow): ResolvedModel | null => {
        const channel = channelMap.get(model.channel_id);
        return channel ? { channel, model } : null;
    };

    let hit: ResolvedModel | null = null;
    if (channelId) {
        const exact = models.find((row) => row.channel_id === channelId && row.model_id === modelId);
        if (exact) hit = pair(exact);
    }
    if (!hit) {
        const candidates = models
            .filter((row) => row.model_id === modelId)
            .map(pair)
            .filter((row): row is ResolvedModel => row !== null);
        if (candidates.length > 1) throw fail(400, 'INVALID_PARAM', '模型标识已失效，请重新选择');
        hit = candidates[0] ?? null;
    }
    if (!hit) throw fail(403, 'MODEL_NOT_GRANTED', '模型未授权或已停用');
    if (!hit.model.enabled || !hit.channel.enabled) throw fail(403, 'MODEL_NOT_GRANTED', '模型已停用');
    return hit;
}

/** 生效授权：成员级 > 角色级 > 空间级；都没有则不可见。 */
export async function resolveGrant(model: ModelRow, userId: string, roleKey: string): Promise<GrantRow | undefined> {
    const rows = await query<GrantRow>('SELECT * FROM model_grants WHERE model_id = $1 AND enabled', [model.id]);
    const find = (type: SubjectType, id: string) => rows.find((row) => row.subject_type === type && row.subject_id === id);
    return find('member', userId) ?? find('role', roleKey) ?? find('workspace', '');
}

export function workspaceTimeZone(workspace: WorkspaceRow): string {
    const settings = (workspace.settings ?? {}) as Record<string, unknown>;
    const raw = typeof settings.timezone === 'string' ? settings.timezone.trim() : '';
    if (!raw) return 'Asia/Shanghai';
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: raw });
        return raw;
    } catch {
        return 'Asia/Shanghai';
    }
}

function zoneOffsetMs(timeZone: string, at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour') % 24, pick('minute'), pick('second'));
    return asUtc - at.getTime() + at.getMilliseconds();
}

function zonedMidnight(timeZone: string, year: number, month: number, day: number): Date {
    const guess = Date.UTC(year, month - 1, day);
    const firstOffset = zoneOffsetMs(timeZone, new Date(guess));
    const secondOffset = zoneOffsetMs(timeZone, new Date(guess - firstOffset));
    return new Date(guess - secondOffset);
}

export interface PeriodBounds {
    day: string;
    month: string;
    dayStartAt: Date;
    monthStartAt: Date;
    dayResetAt: Date;
    monthResetAt: Date;
}

/** 按空间时区切分日/月周期。 */
export function periodBounds(timeZone: string, now = new Date()): PeriodBounds {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const year = pick('year');
    const month = pick('month');
    const day = pick('day');
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;
    return {
        day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        month: `${year}-${String(month).padStart(2, '0')}-01`,
        dayStartAt: zonedMidnight(timeZone, year, month, day),
        monthStartAt: zonedMidnight(timeZone, year, month, 1),
        dayResetAt: zonedMidnight(timeZone, year, month, day + 1),
        monthResetAt: zonedMidnight(timeZone, nextMonthYear, nextMonth, 1),
    };
}

/** 空间时区某天 00:00 的 UTC 时刻（YYYY-MM-DD）。 */
export function zonedDayStart(timeZone: string, day: string): Date {
    const [year, month, date] = day.split('-').map(Number);
    return zonedMidnight(timeZone, year, month, date);
}

export function addDays(day: string, delta: number): string {
    const [year, month, date] = day.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, date + delta));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export function isDayString(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export interface QuotaCounters {
    day: number;
    month: number;
}

export async function countersFor(grantIds: string[], timeZone: string): Promise<Map<string, QuotaCounters>> {
    const result = new Map<string, QuotaCounters>();
    if (grantIds.length === 0) return result;
    const bounds = periodBounds(timeZone);
    const rows = await query<{ grant_id: string; period: string; calls: number }>(
        `SELECT grant_id, period, calls FROM usage_counters
         WHERE grant_id = ANY($1::text[]) AND period_start IN ($2::date, $3::date)`,
        [grantIds, bounds.day, bounds.month],
    );
    for (const row of rows) {
        const current = result.get(row.grant_id) ?? { day: 0, month: 0 };
        if (row.period === 'day') current.day = Number(row.calls);
        else current.month = Number(row.calls);
        result.set(row.grant_id, current);
    }
    return result;
}

function quotaError(model: ModelRow, channel: ChannelRow, limitType: 'daily' | 'monthly', limit: number, used: number, resetsAt: Date) {
    return fail(402, 'QUOTA_EXCEEDED', limitType === 'daily' ? '今日额度已用完' : '本月额度已用完', {
        model: modelValue(channel.id, model.model_id),
        limitType,
        limit,
        used,
        resetsAt: resetsAt.toISOString(),
        applyHint: '请联系空间管理员调整额度',
    });
}

/** 预扣一次调用；超出日/月上限时抛 402，事务回滚保证计数不变。 */
export async function admit(model: ModelRow, channel: ChannelRow, grant: GrantRow, timeZone: string): Promise<void> {
    if (grant.daily_limit === null && grant.monthly_limit === null) return;
    const bounds = periodBounds(timeZone);
    await tx(async (client) => {
        await client.query(
            `INSERT INTO usage_counters (grant_id, period, period_start)
             VALUES ($1, 'day', $2::date), ($1, 'month', $3::date)
             ON CONFLICT DO NOTHING`,
            [grant.id, bounds.day, bounds.month],
        );
        const { rows } = await client.query<{ period: string; calls: number }>(
            `SELECT period, calls FROM usage_counters
             WHERE grant_id = $1 AND period_start IN ($2::date, $3::date)
             FOR UPDATE`,
            [grant.id, bounds.day, bounds.month],
        );
        const used = { day: 0, month: 0 };
        for (const row of rows) {
            if (row.period === 'day') used.day = Number(row.calls);
            else used.month = Number(row.calls);
        }
        if (grant.daily_limit !== null && used.day + 1 > grant.daily_limit) {
            throw quotaError(model, channel, 'daily', grant.daily_limit, used.day, bounds.dayResetAt);
        }
        if (grant.monthly_limit !== null && used.month + 1 > grant.monthly_limit) {
            throw quotaError(model, channel, 'monthly', grant.monthly_limit, used.month, bounds.monthResetAt);
        }
        await client.query(
            `UPDATE usage_counters SET calls = calls + 1, updated_at = now()
             WHERE grant_id = $1 AND period_start IN ($2::date, $3::date)`,
            [grant.id, bounds.day, bounds.month],
        );
    });
}

/** 失败时归还预扣，避免上游故障吃掉用户额度。 */
export async function release(grantId: string | null, timeZone: string): Promise<void> {
    if (!grantId) return;
    const bounds = periodBounds(timeZone);
    await query(
        `UPDATE usage_counters SET calls = GREATEST(calls - 1, 0), updated_at = now()
         WHERE grant_id = $1 AND period_start IN ($2::date, $3::date)`,
        [grantId, bounds.day, bounds.month],
    );
}

/** 与前端 guessCapability 保持一致的粗推断。 */
export function guessCapability(modelId: string): Capability {
    const name = modelId.toLowerCase();
    if (['video', 'sora', 'veo', 'kling', 'wan', 'hailuo'].some((word) => name.includes(word))) return 'video';
    if (['audio', 'tts', 'speech', 'voice', 'music', 'sound'].some((word) => name.includes(word))) return 'audio';
    if (
        ['seedream', 'gpt-image', 'image', 'dall-e', 'dalle', 'imagen', 'flux', 'sdxl', 'stable-diffusion', 'midjourney'].some(
            (word) => name.includes(word),
        )
    ) {
        return 'image';
    }
    return 'text';
}

export function estimateCostMicros(pricing: Record<string, unknown>, units = 1): number {    const amount = typeof pricing.amount === 'number' ? pricing.amount : 0;
    return Math.max(0, Math.round(amount * 1_000_000 * units));
}

export interface UsageInput {
    workspaceId: string;
    userId: string;
    grantId?: string | null;
    channelId?: string | null;
    modelPk?: string | null;
    modelId: string;
    capability: string;
    entry: string;
    status: 'succeeded' | 'failed';
    errorCode?: string | null;
    units?: number;
    latencyMs?: number | null;
    costMicros?: number;
}

export async function recordUsage(input: UsageInput): Promise<void> {
    await query(
        `INSERT INTO usage_records
            (id, workspace_id, user_id, grant_id, channel_id, model_pk, model_id, capability, entry, status, error_code, units, latency_ms, cost_micros)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
            sortableId(),
            input.workspaceId,
            input.userId,
            input.grantId ?? null,
            input.channelId ?? null,
            input.modelPk ?? null,
            input.modelId,
            input.capability,
            input.entry,
            input.status,
            input.errorCode ?? null,
            input.units ?? 1,
            input.latencyMs ?? null,
            input.costMicros ?? 0,
        ],
    );
}
