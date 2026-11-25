export interface UserRow {
    id: string;
    email: string;
    password_hash: string;
    display_name: string;
    avatar_url: string | null;
    email_verified_at: Date | null;
    status: string;
    failed_login_count: number;
    locked_until: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface SessionRow {
    id: string;
    user_id: string;
    token_hash: string;
    user_agent: string | null;
    ip: string | null;
    remember: boolean;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
}

export interface WorkspaceRow {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    plan: string;
    member_limit: number;
    settings: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface MemberRow {
    workspace_id: string;
    user_id: string;
    role_key: string;
    status: string;
    invited_by: string | null;
    joined_at: Date;
    last_active_at: Date | null;
    email: string;
    display_name: string;
    avatar_url: string | null;
}

export interface ProjectRow {
    id: string;
    workspace_id: string;
    owner_id: string;
    title: string;
    visibility: string;
    node_count: number;
    version: number;
    thumbnail_url: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

export interface AssetRow {
    id: string;
    workspace_id: string;
    owner_id: string;
    kind: string;
    title: string;
    cover_url: string | null;
    tags: string[];
    source: string | null;
    note: string | null;
    storage_key: string | null;
    bytes: string | number | null;
    mime_type: string | null;
    width: number | null;
    height: number | null;
    visibility: string;
    created_at: Date;
    updated_at: Date;
}

export interface AuthContext {
    user: UserRow;
    session: SessionRow;
    ip: string;
}

export interface WorkspaceContext {
    workspace: WorkspaceRow;
    member: MemberRow;
    roleKey: string;
    roleName: string;
    permissions: string[];
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            auth?: AuthContext;
        }
    }
}
