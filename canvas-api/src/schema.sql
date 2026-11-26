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

-- 模型渠道：上游 Base URL + 加密后的 Key，只存在服务端。
CREATE TABLE IF NOT EXISTS channels (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    base_url text NOT NULL,
    api_key_cipher text NOT NULL,
    api_key_hint text NOT NULL,
    api_format text NOT NULL DEFAULT 'openai',
    headers_cipher text,
    timeout_ms integer NOT NULL DEFAULT 60000,
    retry integer NOT NULL DEFAULT 1,
    enabled boolean NOT NULL DEFAULT true,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_workspace_name_idx
    ON channels(workspace_id, lower(name)) WHERE deleted_at IS NULL;

-- 模型条目：渠道下的一个上游模型，带能力、参数模板与计价。
CREATE TABLE IF NOT EXISTS models (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    model_id text NOT NULL,
    display_name text NOT NULL,
    capabilities text[] NOT NULL DEFAULT '{image}',
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (channel_id, model_id)
);
CREATE INDEX IF NOT EXISTS models_workspace_idx ON models(workspace_id);

-- 授权：模型 × 主体（空间 / 角色 / 成员），可见性、入口、配额都在这一行。
CREATE TABLE IF NOT EXISTS model_grants (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    model_id text NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    subject_type text NOT NULL,
    subject_id text NOT NULL DEFAULT '',
    visible boolean NOT NULL DEFAULT true,
    entries text[] NOT NULL DEFAULT '{canvas,image,video,assistant,agent,api}',
    daily_limit integer,
    monthly_limit integer,
    enabled boolean NOT NULL DEFAULT true,
    updated_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (model_id, subject_type, subject_id)
);

-- 空间级默认模型：能力 → 模型条目。
CREATE TABLE IF NOT EXISTS model_bindings (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    capability text NOT NULL,
    model_id text NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, capability)
);

-- 用量明细：一次调用一行，不存请求/响应体。
CREATE TABLE IF NOT EXISTS usage_records (
    id text PRIMARY KEY,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    grant_id text,
    channel_id text,
    model_pk text,
    model_id text NOT NULL,
    capability text NOT NULL,
    entry text NOT NULL,
    status text NOT NULL,
    error_code text,
    units integer NOT NULL DEFAULT 1,
    unit_type text NOT NULL DEFAULT 'call',
    latency_ms integer,
    cost_micros bigint NOT NULL DEFAULT 0,
    request_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_records_ws_time_idx ON usage_records(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_records_ws_user_time_idx ON usage_records(workspace_id, user_id, created_at DESC);

-- 配额计数：按授权对象与周期累计，预扣在此表加行锁。
CREATE TABLE IF NOT EXISTS usage_counters (
    grant_id text NOT NULL,
    period text NOT NULL,
    period_start date NOT NULL,
    calls integer NOT NULL DEFAULT 0,
    cost_micros bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (grant_id, period, period_start)
);
