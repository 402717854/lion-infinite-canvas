import { decryptSecret } from './crypto.js';
import { fail } from './http.js';
import type { ChannelRow } from './models.js';

/** Base URL 已带版本号就不再补 /v1，与前端 buildApiUrl 保持一致。 */
export function buildUpstreamUrl(baseUrl: string, path: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    const withVersion = /\/v\d+[a-z]*$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
    return `${withVersion}${path.startsWith('/') ? path : `/${path}`}`;
}

/** 渠道密钥 + 自定义请求头（可选），全部在服务端解密。 */
export function channelHeaders(channel: ChannelRow, extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
        authorization: `Bearer ${decryptSecret(channel.api_key_cipher)}`,
    };
    if (channel.headers_cipher) {
        try {
            const custom = JSON.parse(decryptSecret(channel.headers_cipher)) as Record<string, string>;
            for (const [key, value] of Object.entries(custom)) {
                if (typeof value === 'string' && value) headers[key.toLowerCase()] = value;
            }
        } catch {
            // 自定义头损坏时忽略，不影响主链路。
        }
    }
    return { ...headers, ...extra };
}

/** 上游错误摘要：抹掉密钥与 Bearer，截断到 200 字。 */
export function sanitizeMessage(raw: string): string {
    return raw
        .replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-…')
        .replace(/Bearer\s+[A-Za-z0-9._-]{4,}/gi, 'Bearer …')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}

export interface UpstreamFailure {
    status?: number;
    summary: string;
}

export async function readUpstreamFailure(response: Response): Promise<UpstreamFailure> {
    let summary = `上游返回 ${response.status}`;
    try {
        const text = await response.text();
        if (text) {
            try {
                const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
                const message =
                    typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message ?? '');
                summary = message ? `${response.status} · ${message}` : `${response.status} · ${text}`;
            } catch {
                summary = `${response.status} · ${text}`;
            }
        }
    } catch {
        // 读取失败就只用状态码。
    }
    return { status: response.status, summary: sanitizeMessage(summary) };
}

export function upstreamError(failure: UpstreamFailure, upstreamStatus?: number) {
    return fail(502, 'UPSTREAM_ERROR', '上游服务异常，请稍后重试或联系管理员', {
        upstreamStatus: upstreamStatus ?? failure.status ?? null,
        summary: failure.summary,
    });
}

/**
 * 带超时与重试的上游请求。重试只覆盖网络错误与 5xx，且调用方明确允许时才做。
 */
export async function upstreamFetch(
    channel: ChannelRow,
    path: string,
    init: RequestInit,
    options: { retry?: boolean } = {},
): Promise<Response> {
    const url = buildUpstreamUrl(channel.base_url, path);
    const attempts = options.retry === false ? 1 : Math.max(1, Math.min(2, channel.retry + 1));
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetch(url, { ...init, signal: AbortSignal.timeout(channel.timeout_ms) });
            if (response.status >= 500 && attempt < attempts) {
                await response.body?.cancel();
                continue;
            }
            return response;
        } catch (err) {
            lastError = err;
            if (attempt >= attempts) break;
        }
    }
    const reason = lastError instanceof Error ? lastError.message : '网络错误';
    throw upstreamError({ summary: sanitizeMessage(`请求上游失败：${reason}`) });
}
