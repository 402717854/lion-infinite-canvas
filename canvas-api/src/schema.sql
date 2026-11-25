-- 无限画布团队平台（M1/M2）幂等建表。
-- 所有 id 使用 nanoid 文本；时间为 timestamptz；会话与令牌只存 sha256 哈希。

CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    avatar_url text,
    email_verified_at timestamptz,
    status text NOT NULL DEFAULT 'active',
    failed_login_count integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    user_agent text,
    ip text,
    remember boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS email_tokens (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    owner_id text NOT NULL REFERENCES users(id),
    plan text NOT NULL DEFAULT 'free',
    member_limit integer NOT NULL DEFAULT 50,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_key text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    invited_by text,
    joined_at timestamptz NOT NULL DEFAULT now(),
    last_active_at timestamptz,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_roles (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key text NOT NULL,
    permissions jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS invitations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email text,
    role_key text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending',
    expires_at timestamptz NOT NULL,
    max_uses integer NOT NULL DEFAULT 1,
    used_count integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_workspace_idx ON invitations(workspace_id);

CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_id text NOT NULL,
    title text NOT NULL,
    visibility text NOT NULL DEFAULT 'private',
    node_count integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    thumbnail_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id);

CREATE TABLE IF NOT EXISTS project_docs (
    project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    doc jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS project_collaborators (
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access text NOT NULL DEFAULT 'view',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS assets (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    cover_url text,
    tags text[] NOT NULL DEFAULT '{}',
    source text,
    note text,
    storage_key text,
    bytes bigint,
    mime_type text,
    width integer,
    height integer,
    visibility text NOT NULL DEFAULT 'workspace',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_workspace_idx ON assets(workspace_id);

CREATE TABLE IF NOT EXISTS files (
    key text PRIMARY KEY,
    workspace_id text NOT NULL,
    owner_id text NOT NULL,
    name text,
    bytes bigint NOT NULL,
    mime_type text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 审计只追加（应用层只做 INSERT / SELECT）。
CREATE TABLE IF NOT EXISTS audit_logs (
    id text PRIMARY KEY,
    workspace_id text,
    actor_id text,
    actor_name text,
    actor_ip text,
    action text NOT NULL,
    target_type text,
    target_id text,
    result text NOT NULL DEFAULT 'success',
    diff jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_workspace_idx ON audit_logs(workspace_id, id DESC);
