export const API_BASE = import.meta.env.VITE_API_BASE || "";

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
        public data?: unknown,
        public requestId?: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export function readCookie(name: string) {
    return document.cookie
        .split("; ")
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

type RequestOptions = {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
};

type ApiEnvelope<T> = { code: string; message: string; data: T; requestId: string };

async function parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let payload: ApiEnvelope<T> | null = null;
    try {
        payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
    } catch {
        payload = null;
    }
    if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
        throw new ApiError(response.status, payload?.code || "HTTP_ERROR", payload?.message || response.statusText, payload?.data, payload?.requestId);
    }
    return (payload?.data ?? payload) as T;
}

function buildHeaders(method: string, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasBody) headers["content-type"] = "application/json";
    if (method !== "GET") {
        const csrf = readCookie("ic_csrf");
        if (csrf) headers["x-csrf-token"] = csrf;
    }
    return headers;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method || "GET";
    const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: buildHeaders(method, options.body !== undefined),
        credentials: "include",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
    });
    return parseResponse<T>(response);
}

export async function apiUpload<T>(path: string, blob: Blob, meta: Record<string, string | number | undefined>): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(meta)) {
        if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const response = await fetch(`${API_BASE}${path}?${query.toString()}`, {
        method: "POST",
        headers: buildHeaders("POST", false),
        credentials: "include",
        body: blob,
    });
    return parseResponse<T>(response);
}

const ERROR_MESSAGES: Record<string, string> = {
    UNAUTHENTICATED: "请先登录",
    INVALID_CREDENTIALS: "邮箱或密码错误",
    EMAIL_NOT_VERIFIED: "请先验证邮箱后再使用团队功能",
    PERMISSION_DENIED: "你没有该操作的权限",
    NOT_FOUND: "不存在或无权访问",
    VERSION_CONFLICT: "项目已在其他位置更新，请刷新后再保存",
    LOCKED: "尝试次数过多，请稍后再试",
    RATE_LIMITED: "操作过于频繁，请稍后再试",
    REGISTRATION_CLOSED: "当前空间未开放注册",
    INVITE_REQUIRED: "需要有效邀请链接才能注册",
    INVITE_INVALID: "邀请链接无效或已过期",
    LAST_OWNER: "必须保留至少一名所有者",
    CANNOT_MODIFY_SELF: "不能修改自己的角色",
    ALREADY_MEMBER: "该用户已在空间中",
};

export function apiErrorMessage(error: unknown) {
    if (error instanceof ApiError) return ERROR_MESSAGES[error.code] || error.message || "请求失败";
    return error instanceof Error ? error.message : "请求失败";
}
