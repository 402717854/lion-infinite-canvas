# 模型管理 M3 需求文档

> 状态：待确认。确认范围与边界值后再落地。
> 上游依据：《无限画布 PRD-登录注册-模型管理-权限管理》§4 D3/D5、§7.2、§9、§10.3、§10.4。
> 相关：docs/index.md、canvas-api/README.md、docs/pending-test.md。

## 0 一句话

把「谁用哪个模型、能在哪用、能用多少」收归服务端：渠道与密钥只存在服务端，模型按角色/成员授权，生成请求统一走 `/v1/gateway/**`，每次调用计量入账，超额硬拦截。

## 1 现状与缺口

| 能力 | 现状（M1/M2 之后） | M3 目标 |
| --- | --- | --- |
| 渠道与密钥 | 每个成员浏览器 localStorage 各存一份明文 Key（`use-config-store.ts`） | 服务端托管，AES-256-GCM 落库，接口只回掩码 |
| 模型 | 本地 `channels[].models[]`，能力靠关键词猜 | 服务端模型条目：能力、参数模板、计价、启用状态 |
| 授权 | 无 | 模型 × 主体（空间/角色/成员）授权 + 入口白名单 |
| 配额 | 无 | 日/月上限，预扣 + 硬拦截 |
| 调用 | 浏览器直连上游，Key 随请求发出 | 团队模式走网关，Key 不出服务端 |
| 用量 | 无 | `usage_records` + 报表 + CSV |
| 审计 | 项目/成员/角色/素材 | 渠道、密钥、模型、授权的变更全部落审计 |

可直接复用的既有资产：

- 权限点已预留：`model.read`、`model.use`、`model.channel.manage`、`model.entry.manage`、`model.grant.manage`、`usage.read`、`usage.export`（`web/src/constant/permissions.json`，前后端共用一个来源）。
- 模型值编码 `channelId::model`（`encodeChannelModel`/`decodeChannelModel`）与 `guessCapability` 关键词表。
- `requireWorkspace(req, wsId, permission)`、`rolePermissions`、`writeAudit`、`ok/fail/parse` 信封式契约。
- `files` 表 + 签名 URL（`lib/storage.ts`、`routes/files.ts`）用于承接生成媒体。
- `workspaces.settings` jsonb 用于空间级策略（时区、允许脚本等）。

## 2 范围

### 2.1 一期（P0，本次落地）

1. 渠道 CRUD + 密钥加密托管 + 掩码回显 + 轮换 + 连通性测试。
2. 模型条目 CRUD + 从上游 `GET /models` 批量导入 + 能力推断 + 参数模板 + 计价。
3. 授权矩阵：可见性、可用入口、日/月次数上限；空间级四类默认模型绑定。
4. 网关：`images/generations`、`images/edits`、`videos`（建任务/轮询/取内容）、`responses`（SSE 透传）、`audio/speech`。
5. 配额预扣与结算，超限 `402 QUOTA_EXCEEDED`。
6. 用量明细、聚合报表、CSV 导出。
7. 审计：渠道/密钥/模型/授权变更。
8. 前端：模型管理（渠道与模型 / 授权与配额 / 用量与成本）三个页面；生成入口切到网关；空态与超限提示。

### 2.2 二期（P1，本次不做）

熔断与降级链、模型别名预设、按金额配额、成本告警与通知、申请额度流程、个人访问令牌（PAT）、`Idempotency-Key`、视频结果落盘、受管脚本模式、平台渠道跨空间下发、角色级默认模型覆盖。

### 2.3 明确不做

计费与账单（只做估算）、跨空间共享渠道、模型市场、上游模型下线的自动通知、用量按日分区表、多币种。

## 3 概念模型

```
workspaces ─┬─ channels ─── models ─┬─ model_grants（空间 / 角色 / 成员）
            │                      └─ model_bindings（能力 → 默认模型）
            ├─ usage_records（一次调用一行）
            └─ usage_counters（授权对象的日/月计数）
```

- **渠道**：一个上游 Base URL + 一把 Key + 协议形态。
- **模型条目**：渠道下的一个上游模型名，带能力、参数模板、计价。
- **授权**：`模型 × 主体`，主体是空间全员、某个内置角色、或某个成员；一条授权同时承载「可见 / 可用入口 / 配额」。
- **绑定**：空间级四类（image/video/text/audio）默认模型，决定新节点用哪个模型。

## 4 数据模型

在 `canvas-api/src/schema.sql` 追加 6 张表，全部幂等建表；id 用 `nanoid`；时间 `timestamptz`。

### 4.1 channels

```sql
CREATE TABLE IF NOT EXISTS channels (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    base_url text NOT NULL,
    api_key_cipher text NOT NULL,             -- AES-256-GCM 密文，永不出接口
    api_key_hint text NOT NULL,               -- 掩码，如 sk-••••a1b2，无需解密即可回显
    api_format text NOT NULL DEFAULT 'openai',-- 一期只允许 openai 兼容
    headers_cipher text,                      -- 额外请求头（JSON 密文），一期留空
    timeout_ms integer NOT NULL DEFAULT 60000,
    retry integer NOT NULL DEFAULT 1,
    enabled boolean NOT NULL DEFAULT true,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_workspace_name_idx
    ON channels (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

### 4.2 models

```sql
CREATE TABLE IF NOT EXISTS models (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    model_id text NOT NULL,                   -- 上游模型名，网关请求时写回 body.model
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
CREATE INDEX IF NOT EXISTS models_workspace_idx ON models (workspace_id);
```

`params` 按能力分组，成员端只能选模板内的值；模板缺省的键表示「不限制，前端默认值直通」：

```json
{
  "image": { "size": { "options": ["1:1", "16:9", "9:16"], "default": "1:1" },
             "quality": { "options": ["auto", "high"], "default": "auto" },
             "background": { "options": ["", "opaque", "transparent"], "default": "" },
             "count": { "options": ["1", "2", "4"], "default": "1" } },
  "video": { "seconds": { "options": ["6", "10"], "default": "6" },
             "vquality": { "options": ["720", "1080"], "default": "720" },
             "generateAudio": { "options": ["true", "false"], "default": "true" },
             "watermark": { "options": ["false", "true"], "default": "false" },
             "videoMode": { "options": ["frames", "reference"], "default": "frames" } },
  "text": { "reasoningEffort": { "options": ["auto", "low", "medium", "high"], "default": "auto" } },
  "audio": { "voice": { "options": ["alloy", "echo", "fable"], "default": "alloy" },
             "speed": { "options": ["0.5", "1", "1.5", "2"], "default": "1" },
             "format": { "options": ["mp3", "wav"], "default": "mp3" } }
}
```

`pricing`：`{ "unit": "call", "amount": 0.05, "currency": "CNY" }`。`unit` 一期只用 `call`；`amount` 用于估算金额，不做真实计费。

### 4.3 model_grants

```sql
CREATE TABLE IF NOT EXISTS model_grants (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    model_id text NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    subject_type text NOT NULL,               -- workspace | role | member
    subject_id text NOT NULL DEFAULT '',      -- workspace 为空串；role 为 role_key；member 为 user_id
    visible boolean NOT NULL DEFAULT true,
    entries text[] NOT NULL DEFAULT '{canvas,image,video,assistant,agent,api}',
    daily_limit integer,                      -- null = 不限
    monthly_limit integer,                    -- null = 不限
    enabled boolean NOT NULL DEFAULT true,
    updated_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (model_id, subject_type, subject_id)
);
```

`visible=true` 但 `entries='{}'` 表示「可见但不可用」（原型里的可用性开关）。

### 4.4 model_bindings

```sql
CREATE TABLE IF NOT EXISTS model_bindings (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    capability text NOT NULL,                 -- image | video | text | audio
    model_id text NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, capability)
);
```

### 4.5 usage_records / usage_counters

```sql
CREATE TABLE IF NOT EXISTS usage_records (
    id text PRIMARY KEY,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    grant_id text,                            -- 命中的授权；owner/admin 绕过授权时为空
    channel_id text,
    model_pk text,                            -- models.id
    model_id text NOT NULL,                   -- 上游模型名，快照
    capability text NOT NULL,
    entry text NOT NULL,
    status text NOT NULL,                     -- succeeded | failed
    error_code text,
    units integer NOT NULL DEFAULT 1,
    unit_type text NOT NULL DEFAULT 'call',
    latency_ms integer,
    cost_micros bigint NOT NULL DEFAULT 0,
    request_hash text,                        -- sha256(用户 + 模型 + 入口 + 时间片)，不存请求体
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_records_ws_time_idx ON usage_records (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_records_ws_user_time_idx ON usage_records (workspace_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_counters (
    grant_id text NOT NULL,
    period text NOT NULL,                     -- day | month
    period_start date NOT NULL,               -- 按空间时区切分
    calls integer NOT NULL DEFAULT 0,
    cost_micros bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (grant_id, period, period_start)
);
```

### 4.6 不变量

- 删除渠道 = 软删（`deleted_at`）+ 该渠道全部模型 `enabled=false`；授权保留。
- 删除模型前先删 `model_grants` 与 `model_bindings` 引用（同一事务）。
- `subject_type='role'` 时 `subject_id` 必须属于 `BUILTIN_ROLE_KEYS`（一期无自定义角色）。
- 授权的配额计数以授权行自身为粒度；改了授权对象（例如成员改成角色）后计数从零开始，当日起算。
- 所有写操作写审计，密钥只写 `{ "rotated": true }`。

## 5 权限与判定顺序

### 5.1 权限点

| 权限点 | 含义 | owner/admin | editor | viewer | guest |
| --- | --- | --- | --- | --- | --- |
| `model.read` | 查看渠道与模型（密钥掩码） | ✓ | ✓ | ✓ | — |
| `model.use` | 调用模型（生成） | ✓ | ✓ | — | — |
| `model.channel.manage` | 渠道与密钥 | ✓ | — | — | — |
| `model.entry.manage` | 模型条目与参数模板 | ✓ | — | — | — |
| `model.grant.manage` | 授权与配额 | ✓ | — | — | — |
| `usage.read` | 查看空间用量 | ✓ | — | — | — |
| `usage.export` | 导出用量明细 | ✓ | — | — | — |

表里为 `permissions.json` 现有默认值，不改。

### 5.2 网关判定链

```ts
const ctx = await requireWorkspace(req, wsId, 'model.use');      // 成员 + 权限点
const entry = parseEntry(req.header('x-entry'));                  // canvas|image|video|assistant|agent|api
const model = await resolveModel(wsId, parseModelValue(req.header('x-model'))); // 见 §9.1
if (!model || !model.enabled || !model.channelEnabled) throw fail(403, 'MODEL_NOT_GRANTED', '模型未授权或已停用');
if (ctx.roleKey !== 'owner' && ctx.roleKey !== 'admin') {
    const grant = await resolveGrant(model, ctx.user.id, ctx.roleKey);  // member > role > workspace
    if (!grant || !grant.visible) throw fail(403, 'MODEL_NOT_GRANTED', '模型未授权');
    if (!grant.entries.includes(entry)) throw fail(403, 'ENTRY_NOT_ALLOWED', '该入口不允许使用此模型');
}
const seat = await admit(model, ctx, entry);                      // 预扣，见 §10
// 转发上游 → 结算 → 写 usage_records
```

owner/admin 绕过授权与配额（原型：全入口不可关闭、上限不限），但仍写 `usage_records`。

## 6 管理端接口

全部放在 `/api/workspaces/:id/**`，复用 `requireWorkspace`；写接口沿用 CSRF 双提交。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/channels` | `model.read` | 渠道列表，含模型数、今日调用数、最近成功时间 |
| POST | `/channels` | `model.channel.manage` | 新建渠道 |
| PATCH | `/channels/:cid` | `model.channel.manage` | 改渠道；带 `apiKey` 视为轮换 |
| DELETE | `/channels/:cid` | `model.channel.manage` | 软删 + 停用其模型 |
| POST | `/channels/:cid/test` | `model.channel.manage` | 连通性测试，可用请求体覆盖 baseUrl/apiKey（保存前试） |
| GET | `/channels/:cid/models/upstream` | `model.entry.manage` | 代理上游 `GET /models` |
| POST | `/channels/:cid/models/import` | `model.entry.manage` | 批量导入所选模型 |
| GET | `/models` | `model.read` | 模型条目（可按 `channelId`/`capability` 过滤） |
| POST | `/models` | `model.entry.manage` | 新建条目 |
| PATCH | `/models/:mid` | `model.entry.manage` | 改条目（含启停、参数模板、计价） |
| DELETE | `/models/:mid` | `model.entry.manage` | 删条目，同时清理授权与绑定 |
| GET | `/model-grants?modelId=` | `model.read` | 某模型的授权矩阵 + 今日/本月已用 |
| PUT | `/model-grants` | `model.grant.manage` | 全量保存某模型的授权矩阵 |
| GET | `/model-bindings` | `model.read` | 四类默认模型 |
| PUT | `/model-bindings` | `model.grant.manage` | 保存四类默认模型 |
| GET | `/models/available` | `model.use` | 成员端可见模型 + 参数模板 + 余量 |
| GET | `/usage` | `usage.read` | 聚合报表 |
| GET | `/usage/export.csv` | `usage.export` | 明细导出 |

### 6.1 渠道响应

```json
{
  "id": "ch_7xk2", "name": "公司主渠道", "baseUrl": "https://api.apimart.ai",
  "apiFormat": "openai", "apiKeyMask": "sk-••••a1b2",
  "timeoutMs": 60000, "retry": 1, "enabled": true,
  "modelCount": 12, "todayCalls": 128, "lastOkAt": "2026-11-25T20:38:00+08:00"
}
```

`apiKey` 只在 POST/PATCH 请求里出现，响应永远只有 `apiKeyMask`。

### 6.2 连通性测试

`POST /channels/:cid/test` → `{ ok, status, latencyMs, modelCount, sample: string[], error?: string }`。
实现：`GET {baseUrl}/models`（自动补 `/v1`）带 `Authorization: Bearer <key>`，超时取渠道 `timeoutMs`；失败返回 `ok:false` 与截断 200 字的脱敏错误摘要（去掉 `Bearer` 后的任何 token 文本）。允许「测试失败仍然保存」。

### 6.3 拉取导入

`GET /channels/:cid/models/upstream` → `{ items: [{ id: "gpt-image-2", imported: true }] }`。
`POST /channels/:cid/models/import` body `{ models: [{ modelId, displayName?, capabilities? }] }`：`ON CONFLICT (channel_id, model_id) DO UPDATE`，未给 `capabilities` 时用 `guessCapability` 推断。

### 6.4 授权矩阵保存

`PUT /model-grants` body：

```json
{
  "modelId": "mdl_8f2",
  "items": [
    { "subjectType": "workspace", "subjectId": "", "visible": true, "entries": ["canvas", "image"], "dailyLimit": 200, "monthlyLimit": 3000 },
    { "subjectType": "role", "subjectId": "editor", "visible": true, "entries": ["canvas", "image", "assistant"], "dailyLimit": 50, "monthlyLimit": 800 },
    { "subjectType": "member", "subjectId": "usr_3k", "visible": false, "entries": [], "dailyLimit": null, "monthlyLimit": null }
  ]
}
```

全量替换该模型的授权行：先删后插，同事务；`items` 为空数组表示该模型谁都不可见。

### 6.5 成员端 `/models/available`

```json
{
  "channels": [
    { "id": "ch_7xk2", "name": "公司主渠道", "apiFormat": "openai",
      "models": [
        { "name": "gpt-image-2", "displayName": "gpt-image-2",
          "capabilities": ["image"],
          "params": { "image": { "size": { "options": ["1:1", "16:9"], "default": "1:1" } } } }
      ] }
  ],
  "bindings": { "image": "ch_7xk2::gpt-image-2", "video": "ch_7xk2::grok-imagine-video", "text": "...", "audio": "..." },
  "grants": {
    "ch_7xk2::gpt-image-2": { "visible": true, "entries": ["canvas", "image", "assistant"] }
  },
  "quota": [
    { "model": "ch_7xk2::gpt-image-2",
      "daily": { "limit": 50, "used": 38, "resetsAt": "2026-11-26T00:00:00+08:00" },
      "monthly": { "limit": 800, "used": 312, "resetsAt": "2026-12-01T00:00:00+08:00" } }
  ]
}
```

只返回「已启用渠道 + 已启用模型 + 对该成员可见」的条目；未授权的模型不出现，而不是置灰。

### 6.6 用量

`GET /usage?from=2026-11-18&to=2026-11-25&groupBy=day|user|model|channel&userId=&modelId=&capability=`

```json
{
  "totals": { "calls": 1284, "succeeded": 1237, "failed": 47, "avgLatencyMs": 18400, "costMicros": 426000000 },
  "series": [{ "key": "2026-11-18", "calls": 268, "succeeded": 259, "failed": 9, "costMicros": 88000000 }],
  "rows": [{ "key": "usr_3k", "name": "周可", "calls": 388, "failed": 18, "avgLatencyMs": 19800, "costMicros": 131000000, "dailyLimit": 50, "usedToday": 38 }]
}
```

`from`/`to` 按空间时区解释，区间默认近 7 天，最长 366 天。`avgLatencyMs` 只用成功记录。

`GET /usage/export.csv`：列 `时间,成员,角色,渠道,模型,能力,入口,状态,耗时ms,估算费用(元),错误码`；上限 10 万行，超出返回 `400 INVALID_PARAM`「数据量超过 10 万行，请缩小时间范围」；文件头带 UTF-8 BOM 便于 Excel 打开。

## 7 网关

### 7.1 路由

| 方法 | 路径 | 上游 |
| --- | --- | --- |
| POST | `/v1/gateway/images/generations` | `POST {base}/images/generations` |
| POST | `/v1/gateway/images/edits` | `POST {base}/images/edits`（multipart 原样转发） |
| POST | `/v1/gateway/videos` | `POST {base}/videos` |
| GET | `/v1/gateway/videos/:taskId` | `GET {base}/videos/{id}` |
| GET | `/v1/gateway/videos/:taskId/content` | `GET {base}/videos/{id}/content` |
| POST | `/v1/gateway/responses` | `POST {base}/chat/completions`（SSE 透传） |
| POST | `/v1/gateway/audio/speech` | `POST {base}/audio/speech` |

请求头：

| 头 | 必填 | 说明 |
| --- | --- | --- |
| `x-workspace-id` | 是 | 目标空间；缺省 400 |
| `x-model` | 是 | `channelId::上游模型名`，服务端据此解析模型条目 |
| `x-entry` | 否 | `canvas`(默认) / `image` / `video` / `assistant` / `agent` / `api` |
| `x-csrf-token` | 是 | 沿用双提交（浏览器）；PAT 二期改为 `Authorization: Bearer` |

网关不走 `/api` 信封，响应保持 OpenAI 兼容形态，前端 `image.ts`/`video.ts`/`audio.ts` 的解析逻辑基本不动。

### 7.2 转发要点

- 请求体：JSON 直接解析后覆写 `model` 为条目的上游名再序列化；`images/edits` 用原始 Buffer 转发（保留 boundary），但先用 `busboy` 读出 `model` 字段并与 `x-model` 的裸名比对，不一致返回 400（防止借便宜模型绕过配额）。
- 上游地址：`joinUrl(channel.baseUrl, path)`，`baseUrl` 已含 `/v1` 时不再补，与前端 `buildApiUrl` 规则一致。
- 鉴权：`Authorization: Bearer <解密后的 key>`；上游返回的 `WWW-Authenticate`、`Set-Cookie` 一律丢弃。
- 超时：`AbortController` + `channel.timeoutMs`；超时按 `UPSTREAM_ERROR` 处理。
- 重试：仅在上游 5xx 或超时、且尚未向客户端写出任何字节时重试，次数 `channel.retry`（默认 1），4xx 不重试。
- 流式：`responses` 与上游 `text/event-stream` 用 `pipe` 直通，不缓冲；响应设 `cache-control: no-cache`、`x-accel-buffering: no`、`connection: keep-alive`。
- 响应透传：上游 2xx 的 JSON 原样返回；`images/*` 若结果为 `b64_json`，落盘到 `files`（`key = generated/{workspaceId}/{nanoid}.{ext}`）并把该条改成 `url`（签名 URL，TTL 沿用 `FILE_URL_TTL_SECONDS`），`b64_json` 字段移除，避免响应体过大。
- 视频 URL：`videos` 相关路径只透传，不落盘（一期）。
- 错误映射：

| 上游情况 | 返回 |
| --- | --- |
| 401/403 | 502 `UPSTREAM_ERROR`，`data.upstreamStatus`，摘要「上游鉴权失败，请联系管理员检查密钥」 |
| 429 | 502 `UPSTREAM_ERROR`，摘要「上游限流」，`data.upstreamStatus=429` |
| 4xx 参数类 | 400 `INVALID_PARAM`，摘要取上游 `error.message` 截断 200 字 |
| 5xx / 超时 | 502 `UPSTREAM_ERROR`，摘要截断 200 字 |
| 网络不可达 | 502 `UPSTREAM_ERROR`「渠道不可达」 |

摘要一律脱敏：删除任何形如 `sk-…`、`Bearer …` 的片段，且不回传上游响应体全文。

### 7.3 前端改造点

- 新增 `web/src/stores/use-model-store.ts`：拉取 `/models/available`，暴露 `channels/models/bindings/grants/quota` 与 `reload()`；进入 `/w/:wsId` 时加载，切空间时重置。
- 新增 `web/src/services/api/gateway.ts`：`toGatewayConfig(available, entry)` 产出一个 `AiConfig` 形状的对象：`baseUrl = ${API_BASE}/v1/gateway`、`apiKey = ""`、`channels` 来自服务端、`gateway = { workspaceId, entry }`。
- `use-config-store.ts` 的 `AiConfig` 增加可选 `gateway?: { workspaceId: string; entry: ModelEntry }`（不持久化）；`aiHeaders()` 在 `gateway` 存在时改发 `x-workspace-id`、`x-model`、`x-entry`、`x-csrf-token`，且不发送空的 `Authorization`。
- 入口取值：画布节点/批量生成 → `canvas`；`pages/image/index.tsx` → `image`；`pages/video/index.tsx` → `video`；画布助手 → `assistant`；`canvas-agent`/MCP → `agent`。同一页面里助手调用单独构造一份 `assistant` 配置。
- 模型选择器：团队模式只用 `/models/available` 的结果，显示「模型名（渠道名）」；无可选模型时给出空态「当前空间还没有给你分配模型，请联系管理员」，不静默失败。
- 配额提示：`402` 时展示「今日额度已用完（50/50），明天 00:00 重置」；`403 MODEL_NOT_GRANTED` 时提示「该模型已被管理员收回」并刷新列表。
- 团队模式下「设置 → 渠道」面板只读，提示「空间模型由管理员维护」，并给出跳转管理页的入口（有 `model.channel.manage` 时）。

## 8 配额算法

### 8.1 生效授权

对成员 U（角色 R）与模型 M，按顺序取第一个存在的授权行：`(M, member, U)` → `(M, role, R)` → `(M, workspace, '')`。都不存在 = 不可见。

### 8.2 预扣

```ts
const { dayStart, monthStart, dayResetAt, monthResetAt } = periodBounds(tz); // 空间时区
await tx(async (c) => {
  await c.query(
    'INSERT INTO usage_counters (grant_id, period, period_start) VALUES ($1,\'day\',$2), ($1,\'month\',$3) ON CONFLICT DO NOTHING',
    [grant.id, dayStart, monthStart],
  );
  const { rows } = await c.query(
    'SELECT period, calls FROM usage_counters WHERE grant_id = $1 AND period_start IN ($2,$3) FOR UPDATE',
    [grant.id, dayStart, monthStart],
  );
  // 任一上限已满 → 记下错误，提交后抛出（保证不写脏计数）
  await c.query(
    'UPDATE usage_counters SET calls = calls + 1, updated_at = now() WHERE grant_id = $1 AND period_start IN ($2,$3)',
    [grant.id, dayStart, monthStart],
  );
});
```

行锁保证同授权的并发请求串行判断，不会超发。

### 8.3 超限返回

```json
{
  "code": "QUOTA_EXCEEDED",
  "message": "今日额度已用完",
  "data": {
    "model": "ch_7xk2::gpt-image-2",
    "limitType": "daily",
    "limit": 50,
    "used": 50,
    "resetsAt": "2026-11-26T00:00:00+08:00",
    "applyHint": "请联系空间管理员调整额度"
  }
}
```

### 8.4 结算

- 成功：保留预扣计数，写 `usage_records(status='succeeded', cost_micros = pricing.amount × 1e6 × units)`，`units` 一期固定 1。
- 失败（上游 4xx/5xx/超时/网络错误）：归还预扣（`calls = calls - 1`，不低于 0），写 `usage_records(status='failed', error_code=…)`，费用 0。
- 客户端主动断开（`req.on('close')` 且未收到上游响应）：按失败处理，归还。

失败是否归还预扣见 §12 Q2，确认后按结论调整。

## 9 模型标识兼容

### 9.1 解析规则

网关收到 `x-model`：

1. 含 `::` → 拆成 `channelId` 与 `modelId`；`channelId` 在本空间存在且有同名条目 → 命中。
2. `channelId` 不在本空间（例如来自本地模式的旧画布节点）→ 退回按 `modelId` 在本空间内匹配；唯一命中 → 命中，多于一个 → 400 `INVALID_PARAM`「模型标识已失效，请重新选择」。
3. 不含 `::` → 直接按 `modelId` 匹配，规则同上。

这样旧画布节点 `metadata.model = "gpt::gpt-image-2"` 仍能生成，不需要迁移画布数据。

### 9.2 本地模式不变

`channelMode` 仍由前端按路由决定（`/w/:wsId` 下用托管模型，其余用本地配置）；本地配置不清理、不上传、不覆盖。

## 10 审计

| action | target_type | diff |
| --- | --- | --- |
| `channel.create` | `channel` | 全字段（密钥只留掩码） |
| `channel.update` | `channel` | 变更字段前后值 |
| `channel.key.rotate` | `channel` | `{ "rotated": true }` |
| `channel.delete` | `channel` | `{ "name", "modelCount" }` |
| `channel.test` | `channel` | `{ "ok", "status", "latencyMs" }` |
| `model.create` / `model.update` / `model.delete` | `model` | 变更字段 |
| `model.import` | `channel` | `{ "count", "modelIds" }` |
| `grant.update` | `model` | 授权矩阵前后对比（去掉 null 字段） |
| `binding.update` | `workspace` | 四类绑定前后值 |
| `usage.export` | `workspace` | `{ "from", "to", "rows" }` |

## 11 页面

路由挂在 `WorkspaceLayout` 下：`/w/:wsId/models`、`/w/:wsId/models/grants`、`/w/:wsId/usage`。侧栏在「项目 / 成员 / 角色 / 审计」之后追加「模型」（`model.read`）与「用量」（`usage.read`），没有权限不显示。

### 11.1 渠道与模型（`/models`）

三栏：渠道列表 236px / 模型表自适应 / 渠道设置 318px。

- 渠道卡：名称 + 启用标记、协议形态、模型数、今日调用数、最近成功时间；选中态用 `theme.toolbar.activeBg`。
- 模型表列：模型（显示名 + 上游名不一致时标注）、能力、参数模板摘要（如「尺寸 6 · 质量 3 · 数量 1/2/4」）、授权摘要（全员 / 仅设计组 / admin+ / 未授权）、今日次数、状态。
- 表头操作：「从上游拉取」（多选弹窗，已导入项标「已导入」）、「+ 模型」；底部统计「共 N 个模型 · M 个未授权给任何角色」。
- 渠道设置：显示名称、Base URL、API Key（只读掩码 + 轮换）、超时、重试、启用、连通性测试结果（状态码 + 耗时 + 模型数）。
- 删除渠道前提示「引用该渠道的模型会先被停用，画布节点保留配置但无法生成」。
- 空态：无渠道时居中「先添加一个渠道，再把上游模型导入进来」，主按钮「+ 新增渠道」。

### 11.2 授权与配额（`/models/grants`）

- 顶部选择模型（`模型名 · 渠道名`），支持「复制到其他模型」。
- 矩阵列：角色/成员、可见、可用、可用入口（标签）、日上限、月上限、今日已用（数字 + 进度条）。owner/admin 行只读（全入口、不限）。
- 右侧卡片：配额总览（全空间已用 / 各角色已用进度）、降级链占位（二期）、风险提示。
- 有改动时底部固定条「有未保存的改动 + 变更摘要 + 放弃 / 保存并生效」。
- 未授权模型在成员端不可见；「可见但不可用」用于展示模型存在但不能调用。

### 11.3 用量与成本（`/usage`）

- 筛选：区间（近 7 天 / 近 30 天 / 本月 / 自定义）、成员、模型。
- KPI 四张卡：调用次数、成功率、平均耗时（P95 副标）、估算费用。
- 每日调用柱状图（纯 CSS 柱，不引图表库）、成本构成（按模型进度条）、按成员表格（调用 / 失败 / 平均耗时 / 费用 / 日额度进度）。
- 「导出 CSV」按钮按 `usage.export` 显示。
- 空态：「还没有调用记录」。

页面一律使用 `canvasThemes` / antd token，不硬编码颜色；按钮用扁平无底色样式，符合画布 UI 规范。

## 12 边界值与默认值（需确认）

| 项 | 默认值 | 适用 | 失败处理 |
| --- | --- | --- | --- |
| 渠道超时 | 60s（可设 5–300s） | 网关每次转发 | 502 `UPSTREAM_ERROR`，归还预扣 |
| 渠道重试 | 1 次（可设 0–2） | 上游 5xx/超时 | 重试耗尽按失败处理 |
| 图片响应缓冲上限 | 64MB | `images/*` 落盘前 | 502，提示「上游返回内容过大」 |
| 图片编辑上传上限 | 25MB | `images/edits` 原始 Buffer | 413 `PAYLOAD_TOO_LARGE` |
| JSON 网关请求体 | 20MB | `images/generations`、`responses` | 413 |
| SSE 首字节超时 | 120s | `responses` | 502，断开 |
| 用量导出 | 10 万行 | CSV | 400，提示缩小范围 |
| 用量区间 | 默认 7 天，最长 366 天 | 报表/导出 | 400 |
| 配额周期时区 | `Asia/Shanghai`（存 `workspaces.settings.timezone`） | 日/月切分 | — |
| 签名 URL 有效期 | 沿用 `FILE_URL_TTL_SECONDS`（3600s） | 生成媒体 | 过期后 403，前端重新拉取 |
| 密钥加密 | AES-256-GCM，`APP_ENCRYPTION_KEY` | 渠道密钥 | 生产缺失则启动失败；开发缺失用固定 dev key 并打印警告 |
| 密钥掩码 | 前 3 + `••••` + 后 4；长度 < 12 全掩码 | 接口回显 | — |
| 渠道熔断 | 连续 5 次失败 → 熔断 60s | 二期 | 快速失败「渠道暂时不可用」 |

## 13 实施顺序与工作量（一期）

| 步骤 | 内容 | 估时 |
| --- | --- | --- |
| 1 | schema 追加 6 张表；`lib/crypto.ts`（加解密 + 掩码）；`APP_ENCRYPTION_KEY` | 0.5 天 |
| 2 | 渠道 CRUD + 测试 + 施工审计 | 1 天 |
| 3 | 模型条目 CRUD + 上游拉取 + 导入 + 能力推断 | 1 天 |
| 4 | 授权矩阵 + 绑定 + `models/available` | 1 天 |
| 5 | `lib/models.ts` 解析 + 配额 `admit/settle` | 1 天 |
| 6 | 网关 4 类能力 + 媒体落盘 + 错误映射 + SSE | 2 天 |
| 7 | 用量记录 + 报表 + CSV | 1 天 |
| 8 | 前端三个页面 + 生成入口切换 + 空态/超限 | 2.5 天 |
| 9 | 端到端自测（含 nginx/vite 的 `/v1` 反代） | 0.5 天 |

配套改动：`vite.config.ts` 增加 `/v1` 反代；`nginx.team.conf` 增加 `/v1/` location（`proxy_buffering off`、`proxy_read_timeout` 提到 600s）；`canvas-api/README.md` 补接口说明。

## 14 兼容与迁移

- 不做数据迁移：本地渠道配置留在浏览器，切回本地模式仍可用。
- 旧画布节点 `metadata.model` 按 §9.1 解析，命中即可继续生成。
- 团队模式首次进入时若空间没有渠道，模型选择器为空态，不阻塞画布打开与查看。
- 新增 `APP_ENCRYPTION_KEY` 环境变量：`canvas-api/.env.example` 与 `docker-compose.team.yml` 同步补充。

## 15 验收清单

- [ ] 新增渠道后列表出现，`GET /channels` 不含明文 Key，只有掩码。
- [ ] 连通性测试成功显示状态码、耗时、模型数；失败显示脱敏摘要，且仍可保存。
- [ ] 「从上游拉取」能多选导入；重复导入不产生重复条目，已有项标「已导入」。
- [ ] 模型能力可改；改成「视频」后只出现在视频选择器。
- [ ] 未授权模型在成员端 `/models/available` 中不出现。
- [ ] 授权入口取消勾选「图像」后，图像页调用返回 403 `ENTRY_NOT_ALLOWED`。
- [ ] editor 日上限设为 1，两次调用第二次返回 402，`data` 含 `limitType/limit/used/resetsAt`。
- [ ] 调用成功后用量页计数 +1，失败后成功率下降但配额归还。
- [ ] 关闭渠道后其模型调用返回 403 `MODEL_NOT_GRANTED`。
- [ ] 删除渠道后其模型全部停用，历史画布节点仍能看到模型名。
- [ ] 渠道、模型、授权变更在审计页可见，密钥变更只显示「已轮换」。
- [ ] 导出 CSV 用 Excel 打开中文不乱码。
- [ ] 本地模式（非 `/w/:wsId`）行为与现在完全一致。

## 16 待确认

1. **一期范围**：§2.1 的 8 项是否就是这次的落地范围？尤其「视频结果落盘」「PAT」「按金额配额」是否同意放二期。
2. **配额单位**：一期只按「次数」，金额只用于报表估算，是否可接受？
3. **失败是否归还预扣**：建议归还（上游故障不该吃用户额度），请确认。
4. **owner/admin 是否绕过授权与配额**：建议绕过（与原型一致），但用量照记。
5. **团队模式是否完全禁用本地直连**：建议是（否则配额形同虚设），本地面板保持只读。
6. **Gemini 直连**：一期网关只做 OpenAI 兼容，Gemini 格式渠道二期再支持，是否可接受？
7. **平台渠道（跨空间下发）**：建议二期，一期只有空间自有渠道。
8. **§12 的边界值**：超时 60s、重试 1、导出 10 万行、编辑上传 25MB、密钥 dev 兜底，是否按此实现？
