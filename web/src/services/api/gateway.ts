import type { AiConfig } from "@/stores/use-config-store";
import { API_BASE, readCookie } from "./client";

export type ModelEntry = "canvas" | "image" | "video" | "assistant" | "agent" | "api";

export type GatewayInfo = {
    workspaceId: string;
    entry: ModelEntry;
};

/** 团队模式的统一生成入口，路径与 canvas-api 的 /v1/gateway 对应。 */
export const GATEWAY_BASE_URL = `${API_BASE}/v1/gateway`;

export function isGatewayConfig(config: AiConfig): boolean {
    return Boolean(config.gateway);
}

/** 网关鉴权改用会话 Cookie + 上下文头，密钥不再下发到浏览器。 */
export function gatewayHeaders(config: Pick<AiConfig, "gateway" | "model" | "modelValue">, contentType?: string): Record<string, string> | null {
    const gateway = config.gateway;
    if (!gateway) return null;
    const headers: Record<string, string> = {
        "x-workspace-id": gateway.workspaceId,
        "x-model": config.modelValue || config.model,
        "x-entry": gateway.entry,
    };
    const csrf = readCookie("ic_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
    if (contentType) headers["Content-Type"] = contentType;
    return headers;
}

/** 把一份已解析的模型配置改写成走网关的配置。 */
export function toGatewayConfig(config: AiConfig, value: string): AiConfig {
    const modelValue = (value || config.model || "").trim();
    const at = modelValue.indexOf("::");
    return {
        ...config,
        model: at >= 0 ? modelValue.slice(at + 2) : modelValue,
        modelValue,
        baseUrl: GATEWAY_BASE_URL,
        apiKey: "",
        apiFormat: "openai",
    };
}
