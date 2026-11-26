import express, { Router, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import { nanoid } from 'nanoid';
import { query } from '../db.js';
import { requireWorkspace } from '../auth/session.js';
import { fail } from '../lib/http.js';
import {
    admit,
    estimateCostMicros,
    isEntry,
    modelValue,
    recordUsage,
    release,
    resolveGrant,
    resolveModel,
    workspaceTimeZone,
    type Entry,
    type GrantRow,
    type ResolvedModel,
} from '../lib/models.js';
import { saveBinary, signedUrl } from '../lib/storage.js';
import {
    buildUpstreamUrl,
    channelHeaders,
    readUpstreamFailure,
    sanitizeMessage,
    upstreamError,
    upstreamFetch,
    type UpstreamFailure,
} from '../lib/upstream.js';

export const gatewayRouter = Router();

const JSON_LIMIT = '20mb';
const UPLOAD_LIMIT = '25mb';
const STREAM_FIRST_BYTE_MS = 120_000;

interface Prepared {
    workspaceId: string;
    userId: string;
    roleKey: string;
    entry: Entry;
    resolved: ResolvedModel;
    grant: GrantRow | undefined;
    timeZone: string;
}

/** 网关判定链：成员 + model.use → 模型 → 授权 → 入口（owner/admin 绕过授权）。 */
async function prepare(req: Request): Promise<Prepared> {
    const workspaceId = String(req.header('x-workspace-id') ?? '').trim();
    if (!workspaceId) throw fail(400, 'INVALID_PARAM', '缺少 x-workspace-id');
    const ctx = await requireWorkspace(req, workspaceId, 'model.use');

    const entryRaw = String(req.header('x-entry') ?? '').trim();
    if (entryRaw && !isEntry(entryRaw)) throw fail(400, 'INVALID_PARAM', `未知入口 ${entryRaw}`);
    const entry: Entry = entryRaw ? (entryRaw as Entry) : 'canvas';

    const modelRaw = String(req.header('x-model') ?? '').trim();
    if (!modelRaw) throw fail(400, 'INVALID_PARAM', '缺少 x-model');
    const resolved = await resolveModel(workspaceId, modelRaw);

    const bypass = ctx.roleKey === 'owner' || ctx.roleKey === 'admin';
    let grant: GrantRow | undefined;
    if (!bypass) {
        grant = await resolveGrant(resolved.model, ctx.member.user_id, ctx.roleKey);
        if (!grant || !grant.visible) throw fail(403, 'MODEL_NOT_GRANTED', '模型未授权');
        if (!grant.entries.includes(entry)) throw fail(403, 'ENTRY_NOT_ALLOWED', '该入口不允许使用此模型');
    }
    return {
        workspaceId,
        userId: ctx.member.user_id,
        roleKey: ctx.roleKey,
        entry,
        resolved,
        grant,
        timeZone: workspaceTimeZone(ctx.workspace),
    };
}

/** 预扣额度；owner/admin 与无额度限制的授权不占计数。 */
async function seat(prepared: Prepared): Promise<void> {
    const { grant, resolved, timeZone } = prepared;
    if (!grant) return;
    await admit(resolved.model, resolved.channel, grant, timeZone);
}

function capabilityOf(prepared: Prepared, fallback: string): string {
    const capabilities = prepared.resolved.model.capabilities;
    return capabilities.includes(fallback) ? fallback : (capabilities[0] ?? fallback);
}

async function commit(prepared: Prepared, capability: string, startedAt: number): Promise<void> {
    await recordUsage({
        workspaceId: prepared.workspaceId,
        userId: prepared.userId,
        grantId: prepared.grant?.id ?? null,
        channelId: prepared.resolved.channel.id,
        modelPk: prepared.resolved.model.id,
        modelId: prepared.resolved.model.model_id,
        capability,
        entry: prepared.entry,
        status: 'succeeded',
        latencyMs: Date.now() - startedAt,
        costMicros: estimateCostMicros(prepared.resolved.model.pricing),
    });
}

async function revert(prepared: Prepared, capability: string, errorCode: string, startedAt: number, quotaSeated: boolean) {
    if (quotaSeated) await release(prepared.grant?.id ?? null, prepared.timeZone);
    await recordUsage({
        workspaceId: prepared.workspaceId,
        userId: prepared.userId,
        grantId: prepared.grant?.id ?? null,
        channelId: prepared.resolved.channel.id,
        modelPk: prepared.resolved.model.id,
        modelId: prepared.resolved.model.model_id,
        capability,
        entry: prepared.entry,
        status: 'failed',
        errorCode,
        latencyMs: Date.now() - startedAt,
        costMicros: 0,
    });
}

function throwUpstream(failure: UpstreamFailure, status: number): never {
    if (status === 401 || status === 403) {
        throw upstreamError({ status, summary: '上游鉴权失败，请联系管理员检查密钥' }, status);
    }
    if (status === 429) {
        throw upstreamError({ status, summary: '上游限流，请稍后重试' }, status);
    }
    if (status >= 500) throw upstreamError(failure, status);
    throw fail(400, 'INVALID_PARAM', failure.summary || '上游拒绝了请求', {
        upstreamStatus: status,
        summary: failure.summary,
    });
}

/** 请求体里的 model 必须与 x-model 一致，避免借低额度模型的名义跑高价模型。 */
function assertModelMatch(body: Record<string, unknown>, prepared: Prepared): void {
    const bodyModel = typeof body.model === 'string' ? body.model.trim() : '';
    const bare = prepared.resolved.model.model_id;
    const value = modelValue(prepared.resolved.channel.id, bare);
    if (bodyModel && bodyModel !== bare && bodyModel !== value) {
        throw fail(400, 'INVALID_PARAM', '模型与请求头不一致');
    }
}

function imageExtension(mime: string): string {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'png';
}

/** b64_json 落盘改签名 URL：返回体变小，前端仍按 url 分支消费。 */
async function offloadImages(payload: unknown, prepared: Prepared): Promise<void> {
    const data = (payload as { data?: Array<Record<string, unknown>> })?.data;
    if (!Array.isArray(data)) return;
    for (const item of data) {
        const base64 = typeof item?.b64_json === 'string' ? item.b64_json : '';
        if (!base64) continue;
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length === 0) continue;
        const mime = typeof item?.mime_type === 'string' ? item.mime_type : 'image/png';
        const key = await saveBinary(buffer);
        await query(
            'INSERT INTO files (key, workspace_id, owner_id, name, bytes, mime_type) VALUES ($1,$2,$3,$4,$5,$6)',
            [key, prepared.workspaceId, prepared.userId, `${nanoid()}.${imageExtension(mime)}`, buffer.length, mime],
        );
        item.url = signedUrl(key);
        delete item.b64_json;
    }
}

gatewayRouter.post('/images/generations', express.json({ limit: JSON_LIMIT }), async (req, res) => {
    const prepared = await prepare(req);
    const body = { ...(req.body as Record<string, unknown>) };
    assertModelMatch(body, prepared);
    body.model = prepared.resolved.model.model_id;
    const capability = capabilityOf(prepared, 'image');
    await seat(prepared);
    const startedAt = Date.now();
    let reverted = false;
    try {
        const response = await upstreamFetch(prepared.resolved.channel, '/images/generations', {
            method: 'POST',
            headers: channelHeaders(prepared.resolved.channel, { 'content-type': 'application/json' }),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const failure = await readUpstreamFailure(response);
            await revert(prepared, capability, `UPSTREAM_${response.status}`, startedAt, true);
            reverted = true;
            throwUpstream(failure, response.status);
        }
        const payload = (await response.json()) as unknown;
        await offloadImages(payload, prepared);
        await commit(prepared, capability, startedAt);
        res.status(200).json(payload);
    } catch (err) {
        if (!reverted) await revert(prepared, capability, 'UPSTREAM_ERROR', startedAt, true);
        throw err;
    }
});

gatewayRouter.post('/images/edits', express.raw({ type: () => true, limit: UPLOAD_LIMIT }), async (req, res) => {
    const prepared = await prepare(req);
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (raw.length === 0) throw fail(400, 'INVALID_PARAM', '请求体为空');
    const formModel = readMultipartField(raw, 'model');
    if (formModel && formModel !== prepared.resolved.model.model_id) {
        throw fail(400, 'INVALID_PARAM', '模型与请求头不一致');
    }
    const capability = capabilityOf(prepared, 'image');
    await seat(prepared);
    const startedAt = Date.now();
    let reverted = false;
    try {
        const response = await upstreamFetch(prepared.resolved.channel, '/images/edits', {
            method: 'POST',
            headers: channelHeaders(prepared.resolved.channel, {
                'content-type': String(req.header('content-type') ?? 'application/octet-stream'),
            }),
            body: raw,
        });
        if (!response.ok) {
            const failure = await readUpstreamFailure(response);
            await revert(prepared, capability, `UPSTREAM_${response.status}`, startedAt, true);
            reverted = true;
            throwUpstream(failure, response.status);
        }
        const payload = (await response.json()) as unknown;
        await offloadImages(payload, prepared);
        await commit(prepared, capability, startedAt);
        res.status(200).json(payload);
    } catch (err) {
        if (!reverted) await revert(prepared, capability, 'UPSTREAM_ERROR', startedAt, true);
        throw err;
    }
});

// 视频创建：前端用 multipart 提交首尾帧，也兼容 JSON 调用。
gatewayRouter.post('/videos', express.json({ limit: JSON_LIMIT }), express.raw({ type: () => true, limit: UPLOAD_LIMIT }), async (req, res) => {
    const prepared = await prepare(req);
    const raw = Buffer.isBuffer(req.body) ? req.body : null;
    const json = raw ? null : { ...(req.body as Record<string, unknown>) };
    if (raw) {
        if (raw.length === 0) throw fail(400, 'INVALID_PARAM', '请求体为空');
        const formModel = readMultipartField(raw, 'model');
        if (formModel) assertModelMatch({ model: formModel }, prepared);
    } else {
        assertModelMatch(json!, prepared);
        json!.model = prepared.resolved.model.model_id;
    }
    const capability = capabilityOf(prepared, 'video');
    await seat(prepared);
    const startedAt = Date.now();
    let reverted = false;
    try {
        const response = await upstreamFetch(prepared.resolved.channel, '/videos', {
            method: 'POST',
            headers: channelHeaders(prepared.resolved.channel, {
                'content-type': raw ? String(req.header('content-type') ?? 'application/octet-stream') : 'application/json',
            }),
            body: raw ?? JSON.stringify(json),
        });
        if (!response.ok) {
            const failure = await readUpstreamFailure(response);
            await revert(prepared, capability, `UPSTREAM_${response.status}`, startedAt, true);
            reverted = true;
            throwUpstream(failure, response.status);
        }
        const payload = (await response.json()) as unknown;
        await commit(prepared, capability, startedAt);
        res.status(200).json(payload);
    } catch (err) {
        if (!reverted) await revert(prepared, capability, 'UPSTREAM_ERROR', startedAt, true);
        throw err;
    }
});

/** 轮询与取内容不计入调用次数，只按 x-model 定位通道。 */
async function proxyJsonGet(req: Request, res: Response, upstreamPath: string): Promise<void> {
    const prepared = await prepare(req);
    const response = await upstreamFetch(
        prepared.resolved.channel,
        upstreamPath,
        { method: 'GET', headers: channelHeaders(prepared.resolved.channel, { accept: 'application/json' }) },
        { retry: false },
    );
    if (!response.ok) {
        const failure = await readUpstreamFailure(response);
        if (response.status === 404) throw fail(404, 'NOT_FOUND', '任务不存在或已过期');
        throwUpstream(failure, response.status);
    }
    res.status(response.status);
    res.setHeader('content-type', response.headers.get('content-type') ?? 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.send(await response.text());
}

gatewayRouter.get('/videos/:taskId', async (req, res) => {
    await proxyJsonGet(req, res, `/videos/${encodeURIComponent(req.params.taskId)}`);
});

gatewayRouter.get('/videos/:taskId/content', async (req, res) => {
    const prepared = await prepare(req);
    const response = await upstreamFetch(
        prepared.resolved.channel,
        `/videos/${encodeURIComponent(req.params.taskId)}/content`,
        { method: 'GET', headers: channelHeaders(prepared.resolved.channel) },
        { retry: false },
    );
    if (!response.ok || !response.body) {
        const failure = await readUpstreamFailure(response);
        if (response.status === 404) throw fail(404, 'NOT_FOUND', '视频内容不存在或已过期');
        throwUpstream(failure, response.status);
    }
    res.status(200);
    res.setHeader('content-type', response.headers.get('content-type') ?? 'video/mp4');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('content-length', length);
    res.setHeader('cache-control', 'no-store');
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
});

/**
 * 文本：Chat Completions 透传，请求体为 { model, messages, stream }。
 * stream 为 true 时逐块转发并另设首字节上限；非流式按渠道超时等待完整响应。
 */
gatewayRouter.post('/chat/completions', express.json({ limit: JSON_LIMIT }), async (req, res) => {
    const prepared = await prepare(req);
    const body = { ...(req.body as Record<string, unknown>) };
    assertModelMatch(body, prepared);
    body.model = prepared.resolved.model.model_id;
    const capability = capabilityOf(prepared, 'text');
    await seat(prepared);
    const startedAt = Date.now();

    if (body.stream !== true) {
        let response: globalThis.Response;
        try {
            response = await upstreamFetch(prepared.resolved.channel, '/chat/completions', {
                method: 'POST',
                headers: channelHeaders(prepared.resolved.channel, { 'content-type': 'application/json' }),
                body: JSON.stringify(body),
            });
        } catch (err) {
            await revert(prepared, capability, 'UPSTREAM_ERROR', startedAt, true);
            throw upstreamError({
                summary: sanitizeMessage(`请求上游失败：${err instanceof Error ? err.message : '网络错误'}`),
            });
        }
        if (!response.ok) {
            const failure = await readUpstreamFailure(response);
            await revert(prepared, capability, `UPSTREAM_${response.status}`, startedAt, true);
            throwUpstream(failure, response.status);
        }
        await commit(prepared, capability, startedAt);
        res.status(200);
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.send(await response.text());
        return;
    }

    const controller = new AbortController();
    const firstByteTimer = setTimeout(() => controller.abort(), STREAM_FIRST_BYTE_MS);
    let response: globalThis.Response;
    try {
        response = await fetch(buildUpstreamUrl(prepared.resolved.channel.base_url, '/v1/chat/completions'), {
            method: 'POST',
            headers: channelHeaders(prepared.resolved.channel, {
                'content-type': 'application/json',
                accept: req.header('accept') ?? 'text/event-stream',
            }),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(firstByteTimer);
        await revert(prepared, capability, 'UPSTREAM_ERROR', startedAt, true);
        throw upstreamError({
            summary: sanitizeMessage(`请求上游失败：${err instanceof Error ? err.message : '网络错误'}`),
        });
    }
    clearTimeout(firstByteTimer);

    if (!response.ok) {
        const failure = await readUpstreamFailure(response);
        await revert(prepared, capability, `UPSTREAM_${response.status}`, startedAt, true);
        throwUpstream(failure, response.status);
    }

    await commit(prepared, capability, startedAt);

    const contentType = response.headers.get('content-type') ?? 'application/json';
    res.status(200);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('x-accel-buffering', 'no');
    if (!response.body) {
        res.end();
        return;
    }
    if (!contentType.includes('text/event-stream')) {
        res.send(await response.text());
        return;
    }
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
});

gatewayRouter.post('/audio/speech', express.json({ limit: JSON_LIMIT }), async (req, res) => {
    const prepared = await prepare(req);
    const body = { ...(req.body as Record<string, unknown>) };
    assertModelMatch(body, prepared);
    body.model = prepared.resolved.model.model_id;
    const capability = capabilityOf(prepared, 'audio');
    await seat(prepared);
    const startedAt = Date.now();
    let reverted = false;
    try {
        const response = await upstreamFetch(prepared.resolved.channel, '/audio/speech', {
            method: 'POST',
            headers: channelHeaders(prepared.resolved.channel, { 'content-type': 'application/json' }),
            body: JSON.stringify(body),
        });
        if (!response.ok || !response.body) {
            const failure = await readUpstreamFailure(response);
            await revert(prepared, capability, `UPSTREAM_${response.status}`, startedAt, true);
            reverted = true;
            throwUpstream(failure, response.status);
        }
        await commit(prepared, capability, startedAt);
        res.status(200);
        res.setHeader('content-type', response.headers.get('content-type') ?? 'audio/mpeg');
        res.setHeader('cache-control', 'no-store');
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } catch (err) {
        if (!reverted) await revert(prepared, capability, 'UPSTREAM_ERROR', startedAt, true);
        throw err;
    }
});

/** 从 multipart Buffer 里取一个普通字段值（只用于校验 model）。 */
function readMultipartField(buffer: Buffer, field: string): string | null {
    const text = buffer.toString('latin1');
    const marker = `name="${field}"`;
    const start = text.indexOf(marker);
    if (start < 0) return null;
    const headerEnd = text.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) return null;
    const valueStart = headerEnd + 4;
    const valueEnd = text.indexOf('\r\n', valueStart);
    if (valueEnd < 0) return null;
    return text.slice(valueStart, valueEnd).trim() || null;
}
