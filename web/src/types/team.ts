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
