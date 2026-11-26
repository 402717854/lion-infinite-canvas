export type SessionUser = {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    emailVerified: boolean;
};

export type WorkspaceSummary = {
    id: string;
    name: string;
    slug: string;
    roleKey: string;
    roleName: string;
    permissions: string[];
    memberCount: number;
    ownerId: string;
    createdAt: string;
};

export type Me = {
    user: SessionUser;
    workspaces: WorkspaceSummary[];
};

export type MemberRecord = {
    userId: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    roleKey: string;
    roleName: string;
    status: string;
    joinedAt: string;
    lastActiveAt: string | null;
};

export type RoleRecord = {
    key: string;
    name: string;
    description: string;
    builtin: boolean;
    permissions: string[];
    memberCount: number;
};

export type InvitationRecord = {
    id: string;
    email: string | null;
    roleKey: string;
    status: string;
    expiresAt: string;
    maxUses: number;
    usedCount: number;
    createdAt: string;
};

export type ProjectSummary = {
    id: string;
    workspaceId?: string;
    title: string;
    ownerId: string;
    ownerName: string;
    visibility: "private" | "workspace" | "link";
    nodeCount: number;
    version: number;
    createdAt: string;
    updatedAt: string;
    thumbnailUrl: string | null;
    collaboratorCount: number;
};

export type ProjectDoc = {
    nodes: unknown[];
    connections: unknown[];
    chatSessions: unknown[];
    activeChatId: string | null;
    backgroundMode: string;
    showImageInfo: boolean;
    viewport: { x: number; y: number; k: number };
};

export type ProjectDetail = ProjectSummary & {
    doc: ProjectDoc;
    permissions: { canRead: boolean; canEdit: boolean; canManage: boolean };
};

export type AssetRecord = {
    id: string;
    kind: "text" | "image" | "video";
    title: string;
    coverUrl: string;
    tags: string[];
    source: string | null;
    note: string | null;
    storageKey: string | null;
    bytes: number;
    mimeType: string | null;
    width: number;
    height: number;
    visibility: "private" | "workspace";
    createdAt: string;
    updatedAt: string;
    ownerId: string;
};

export type AuditRecord = {
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    result: string;
    actorId: string;
    actorName: string;
    ip: string;
    createdAt: string;
    diff: Record<string, unknown> | null;
};

export type ModelCapabilityValue = "image" | "video" | "text" | "audio";
export type ModelEntryValue = "canvas" | "image" | "video" | "assistant" | "agent" | "api";
export type ModelSubjectType = "workspace" | "role" | "member";

export type ChannelRecord = {
    id: string;
    name: string;
    baseUrl: string;
    apiKeyMask: string;
    apiFormat: string;
    timeoutMs: number;
    retry: number;
    enabled: boolean;
    modelCount: number;
    todayCalls: number;
    lastOkAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ModelParamDefinition = {
    options?: string[];
    default?: string;
};

export type ModelPricing = {
    unit?: string;
    amount?: number;
    currency?: string;
};

export type ModelGrantItem = {
    subjectType: ModelSubjectType;
    subjectId: string;
    visible: boolean;
    entries: ModelEntryValue[];
    dailyLimit: number | null;
    monthlyLimit: number | null;
};

export type ModelRecord = {
    id: string;
    channelId: string;
    channelName: string;
    modelId: string;
    value: string;
    displayName: string;
    capabilities: ModelCapabilityValue[];
    params: Record<string, Record<string, ModelParamDefinition>>;
    pricing: ModelPricing;
    enabled: boolean;
    channelEnabled: boolean;
    note: string | null;
    grants: ModelGrantItem[];
    todayCalls: number;
};

export type AvailableModel = {
    name: string;
    displayName: string;
    value: string;
    capabilities: ModelCapabilityValue[];
    params: Record<string, Record<string, ModelParamDefinition>>;
    pricing: ModelPricing;
};

export type AvailableChannel = {
    id: string;
    name: string;
    apiFormat: string;
    models: AvailableModel[];
};

export type ModelQuota = {
    model: string;
    daily: { limit: number | null; used: number; resetsAt: string };
    monthly: { limit: number | null; used: number; resetsAt: string };
};

export type AvailableModelsPayload = {
    channels: AvailableChannel[];
    bindings: Record<ModelCapabilityValue, string | null>;
    grants: Record<string, { visible: boolean; entries: ModelEntryValue[] }>;
    quota: ModelQuota[];
};

export type GrantRowRecord = {
    id: string;
    subjectType: ModelSubjectType;
    subjectId: string;
    visible: boolean;
    entries: ModelEntryValue[];
    dailyLimit: number | null;
    monthlyLimit: number | null;
    todayUsed: number;
    monthUsed: number;
};

export type ModelGrantsPayload = {
    model: { id: string; modelId: string; displayName: string; value: string };
    roles: Array<{ key: string; name: string }>;
    members: Array<{ id: string; displayName: string; roleKey: string; roleName: string }>;
    resetsAt: { daily: string; monthly: string };
    items: GrantRowRecord[];
};

export type ModelBindingsPayload = Record<ModelCapabilityValue, { value: string; displayName: string } | null>;

export type UsageTotals = {
    calls: number;
    succeeded: number;
    failed: number;
    avgLatencyMs: number;
    costMicros: number;
};

export type UsageSeriesItem = {
    key: string;
    calls: number;
    succeeded: number;
    failed: number;
    costMicros: number;
    capabilities: Record<string, number>;
};

export type UsageRow = {
    key: string;
    name: string;
    roleKey?: string;
    calls: number;
    failed: number;
    avgLatencyMs: number;
    costMicros: number;
    dailyLimit?: number | null;
    usedToday?: number;
};

export type UsagePayload = {
    range: { from: string; to: string; timeZone: string };
    totals: UsageTotals;
    series: UsageSeriesItem[];
    rows: UsageRow[];
};
