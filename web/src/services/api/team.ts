import { apiRequest, apiUpload } from "@/services/api/client";
import type {
    AssetRecord,
    AuditRecord,
    AvailableModelsPayload,
    ChannelRecord,
    InvitationRecord,
    Me,
    MemberRecord,
    ModelBindingsPayload,
    ModelCapabilityValue,
    ModelEntryValue,
    ModelGrantItem,
    ModelGrantsPayload,
    ModelPricing,
    ModelRecord,
    ProjectDetail,
    ProjectDoc,
    ProjectSummary,
    RoleRecord,
    UsagePayload,
} from "@/types/team";

export type RegisterResult = Me & { verificationToken?: string; pending?: boolean };

export const authApi = {
    me: () => apiRequest<Me>("/api/auth/me"),
    login: (payload: { email: string; password: string; remember?: boolean }) => apiRequest<Me>("/api/auth/login", { method: "POST", body: payload }),
    register: (payload: { email: string; password: string; displayName?: string; inviteToken?: string }) => apiRequest<RegisterResult>("/api/auth/register", { method: "POST", body: payload }),
    logout: () => apiRequest<void>("/api/auth/logout", { method: "POST" }),
    verifyEmail: (token: string) => apiRequest<void>("/api/auth/verify-email", { method: "POST", body: { token } }),
    resendVerification: () => apiRequest<{ verificationToken?: string }>("/api/auth/resend-verification", { method: "POST" }),
    forgotPassword: (email: string) => apiRequest<{ resetToken?: string }>("/api/auth/forgot-password", { method: "POST", body: { email } }),
    resetPassword: (token: string, password: string) => apiRequest<void>("/api/auth/reset-password", { method: "POST", body: { token, password } }),
    sessions: () => apiRequest<{ items: Array<{ id: string; userAgent: string; ip: string; createdAt: string; lastSeenAt: string; current: boolean }> }>("/api/auth/sessions"),
    revokeSession: (sessionId: string) => apiRequest<void>(`/api/auth/sessions/${sessionId}`, { method: "DELETE" }),
};

export const workspaceApi = {
    list: () => apiRequest<Me>("/api/auth/me"),
    create: (name: string) => apiRequest<{ id: string }>("/api/workspaces", { method: "POST", body: { name } }),
    update: (workspaceId: string, payload: { name?: string }) => apiRequest<void>(`/api/workspaces/${workspaceId}`, { method: "PATCH", body: payload }),
    remove: (workspaceId: string, name: string) => apiRequest<void>(`/api/workspaces/${workspaceId}`, { method: "DELETE", body: { name } }),
    transferOwner: (workspaceId: string, userId: string, workspaceName: string) => apiRequest<void>(`/api/workspaces/${workspaceId}/transfer-owner`, { method: "POST", body: { userId, workspaceName } }),
    members: (workspaceId: string) => apiRequest<{ items: MemberRecord[]; total: number }>(`/api/workspaces/${workspaceId}/members`),
    updateMember: (workspaceId: string, userId: string, roleKey: string) => apiRequest<void>(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "PATCH", body: { roleKey } }),
    removeMember: (workspaceId: string, userId: string) => apiRequest<void>(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }),
    invitations: (workspaceId: string) => apiRequest<{ items: InvitationRecord[] }>(`/api/workspaces/${workspaceId}/invitations`),
    createInvitation: (workspaceId: string, payload: { email?: string; roleKey: string; expiresInDays?: number; maxUses?: number }) =>
        apiRequest<{ token: string; inviteUrl: string; invitation: InvitationRecord }>(`/api/workspaces/${workspaceId}/invitations`, { method: "POST", body: payload }),
    revokeInvitation: (workspaceId: string, invitationId: string) => apiRequest<void>(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, { method: "DELETE" }),
    invitation: (token: string) => apiRequest<{ workspaceName: string; inviterName: string; roleKey: string; roleName: string; email: string | null; expiresAt: string }>(`/api/invitations/${token}`),
    acceptInvitation: (token: string) => apiRequest<{ id?: string; workspaceId?: string }>(`/api/invitations/${token}/accept`, { method: "POST" }),
    roles: (workspaceId: string) => apiRequest<{ items: RoleRecord[] }>(`/api/workspaces/${workspaceId}/roles`),
    updateRole: (workspaceId: string, roleKey: string, permissions: string[]) => apiRequest<void>(`/api/workspaces/${workspaceId}/roles/${roleKey}`, { method: "PATCH", body: { permissions } }),
    audit: (workspaceId: string, params: { action?: string; actorId?: string; limit?: number } = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => value !== undefined && value !== "" && query.set(key, String(value)));
        return apiRequest<{ items: AuditRecord[]; nextCursor: string | null }>(`/api/workspaces/${workspaceId}/audit?${query.toString()}`);
    },
};

export const projectApi = {
    list: (workspaceId: string) => apiRequest<{ items: ProjectSummary[] }>(`/api/workspaces/${workspaceId}/projects`),
    detail: (projectId: string) => apiRequest<{ project: ProjectDetail }>(`/api/projects/${projectId}`),
    create: (workspaceId: string, payload: { id?: string; title: string; visibility?: "private" | "workspace" }) => apiRequest<{ project: ProjectSummary }>(`/api/workspaces/${workspaceId}/projects`, { method: "POST", body: payload }),
    save: (projectId: string, payload: { title?: string; doc: ProjectDoc; version: number }) => apiRequest<{ version: number; updatedAt: string }>(`/api/projects/${projectId}`, { method: "PUT", body: payload }),
    remove: (projectId: string) => apiRequest<void>(`/api/projects/${projectId}`, { method: "DELETE" }),
    importBatch: (workspaceId: string, payload: { projects: Array<{ id?: string; title: string; doc: ProjectDoc; visibility?: string }> }) =>
        apiRequest<{ created: Array<{ id: string; title: string }>; failed: Array<{ index: number; reason: string }> }>(`/api/workspaces/${workspaceId}/import`, { method: "POST", body: payload }),
};

export const assetApi = {
    list: (workspaceId: string) => apiRequest<{ items: AssetRecord[] }>(`/api/workspaces/${workspaceId}/assets`),
    upload: (workspaceId: string, blob: Blob, meta: { name: string; mimeType?: string; width?: number; height?: number }) =>
        apiUpload<{ storageKey: string; url: string; bytes: number; mimeType: string }>(`/api/workspaces/${workspaceId}/files`, blob, meta),
    create: (workspaceId: string, payload: Partial<AssetRecord> & { kind: AssetRecord["kind"]; title: string }) =>
        apiRequest<{ asset: AssetRecord }>(`/api/workspaces/${workspaceId}/assets`, { method: "POST", body: payload }),
    remove: (assetId: string) => apiRequest<void>(`/api/assets/${assetId}`, { method: "DELETE" }),
};

export const modelApi = {
    channels: (workspaceId: string) => apiRequest<ChannelRecord[]>(`/api/workspaces/${workspaceId}/channels`),
    createChannel: (workspaceId: string, payload: { name: string; baseUrl: string; apiKey: string; timeoutMs?: number; retry?: number; enabled?: boolean }) =>
        apiRequest<ChannelRecord>(`/api/workspaces/${workspaceId}/channels`, { method: "POST", body: payload }),
    updateChannel: (
        workspaceId: string,
        channelId: string,
        payload: { name?: string; baseUrl?: string; apiKey?: string; timeoutMs?: number; retry?: number; enabled?: boolean },
    ) => apiRequest<ChannelRecord>(`/api/workspaces/${workspaceId}/channels/${channelId}`, { method: "PATCH", body: payload }),
    removeChannel: (workspaceId: string, channelId: string) => apiRequest<{ id: string }>(`/api/workspaces/${workspaceId}/channels/${channelId}`, { method: "DELETE" }),
    testChannel: (workspaceId: string, channelId: string, payload: { baseUrl?: string; apiKey?: string } = {}) =>
        apiRequest<{ ok: boolean; status: number; latencyMs: number; modelCount: number; sample: string[]; summary?: string }>(
            `/api/workspaces/${workspaceId}/channels/${channelId}/test`,
            { method: "POST", body: payload },
        ),
    upstreamModels: (workspaceId: string, channelId: string) =>
        apiRequest<{ items: Array<{ id: string; imported: boolean }> }>(`/api/workspaces/${workspaceId}/channels/${channelId}/models/upstream`),
    importModels: (workspaceId: string, channelId: string, models: Array<{ modelId: string; displayName?: string; capabilities?: ModelCapabilityValue[] }>) =>
        apiRequest<{ created: number; skipped: number }>(`/api/workspaces/${workspaceId}/channels/${channelId}/models/import`, { method: "POST", body: { models } }),
    models: (workspaceId: string, params: { channelId?: string; capability?: string } = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
        return apiRequest<ModelRecord[]>(`/api/workspaces/${workspaceId}/models?${query.toString()}`);
    },
    createModel: (
        workspaceId: string,
        payload: {
            channelId: string;
            modelId: string;
            displayName?: string;
            capabilities?: ModelCapabilityValue[];
            params?: Record<string, unknown>;
            pricing?: ModelPricing;
            enabled?: boolean;
            note?: string | null;
        },
    ) => apiRequest<ModelRecord>(`/api/workspaces/${workspaceId}/models`, { method: "POST", body: payload }),
    updateModel: (
        workspaceId: string,
        modelId: string,
        payload: {
            displayName?: string;
            capabilities?: ModelCapabilityValue[];
            params?: Record<string, unknown>;
            pricing?: ModelPricing;
            enabled?: boolean;
            note?: string | null;
        },
    ) => apiRequest<ModelRecord>(`/api/workspaces/${workspaceId}/models/${modelId}`, { method: "PATCH", body: payload }),
    removeModel: (workspaceId: string, modelId: string) => apiRequest<{ id: string }>(`/api/workspaces/${workspaceId}/models/${modelId}`, { method: "DELETE" }),
    available: (workspaceId: string) => apiRequest<AvailableModelsPayload>(`/api/workspaces/${workspaceId}/models/available`),
    grants: (workspaceId: string, modelId: string) =>
        apiRequest<ModelGrantsPayload>(`/api/workspaces/${workspaceId}/model-grants?modelId=${encodeURIComponent(modelId)}`),
    saveGrants: (workspaceId: string, modelId: string, items: ModelGrantItem[]) =>
        apiRequest<{ modelId: string; items: number }>(`/api/workspaces/${workspaceId}/model-grants`, { method: "PUT", body: { modelId, items } }),
    bindings: (workspaceId: string) => apiRequest<ModelBindingsPayload>(`/api/workspaces/${workspaceId}/model-bindings`),
    saveBindings: (workspaceId: string, payload: Partial<Record<ModelCapabilityValue, string | null>>) =>
        apiRequest<Record<string, string>>(`/api/workspaces/${workspaceId}/model-bindings`, { method: "PUT", body: payload }),
    usage: (
        workspaceId: string,
        params: { from?: string; to?: string; groupBy?: "day" | "user" | "model" | "channel"; userId?: string; modelId?: string; capability?: string; entry?: ModelEntryValue } = {},
    ) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => value && query.set(key, String(value)));
        return apiRequest<UsagePayload>(`/api/workspaces/${workspaceId}/usage?${query.toString()}`);
    },
    exportUsage: async (workspaceId: string, params: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
        const response = await fetch(`${import.meta.env.VITE_API_BASE || ""}/api/workspaces/${workspaceId}/usage/export.csv?${query.toString()}`, {
            credentials: "include",
        });
        if (!response.ok) throw new Error("导出失败，请稍后重试");
        return response.blob();
    },
};
