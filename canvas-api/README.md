# canvas-api

无限画布团队平台的 Node API 服务（M1 账号与空间 + M2 权限与云存储）。实现依据：

- `web/src/constant/permissions.json`（41 个权限点、5 个内置角色默认权限，前后端共用唯一来源）
- PRD 7.1 / 7.3 / 8 / 9 / 10 章

本地与生产部署步骤见 `docs/quick-start.md` 和 `docs/deployment.md`。

技术栈：Express 5 + TypeScript（NodeNext）+ Postgres（pg）+ zod + @node-rs/argon2 + cookie-parser + nanoid。不使用 ORM / Redis / 对象存储；文件落本地磁盘并签发 HMAC URL。

## 快速开始

```bash
# 1. 仓库根目录：启动本地 Postgres（端口 55432，数据在 .dev/pgdata）
node scripts/dev-db.mjs start

# 2. canvas-api
cd canvas-api
npm install --ignore-scripts

# 3. 编译（tsx/esbuild 在当前环境不可用，直接用 tsc 产物运行）
node node_modules/typescript/bin/tsc -p tsconfig.json

# 4. 建表（可重复执行）
node dist/migrate.js

# 5. 冒烟测试（进程内随机端口 + fetch + Cookie jar）
node dist/smoke.js        # 成功输出 SMOKE OK

# 6. 启动服务
node dist/index.js        # 默认 http://127.0.0.1:8787

npm start
```

可选：复制 `.env.example` 为 `canvas-api/.env` 后按需修改；不创建时使用默认值（本机开发库 + `APP_ORIGIN=http://127.0.0.1:3000`）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | API 端口 |
| `DATABASE_URL` | `postgres://postgres@127.0.0.1:55432/infinite_canvas` | Postgres 连接串 |
| `APP_ORIGIN` | `http://127.0.0.1:3000` | CORS 白名单，逗号分隔 |
| `SESSION_COOKIE_SECURE` | `false` | 生产置 `true`（HTTPS Cookie） |
| `REGISTRATION_MODE` | `open` | `open` / `invite` / `closed` |
| `AUTO_VERIFY_EMAIL` | `true` | 关闭后注册返回 `verificationToken`，需走 verify-email |
| `DATA_DIR` | `data/uploads` | 文件落盘目录（相对 canvas-api） |
| `FILE_URL_SECRET` | 开发默认值 | 文件签名 URL 的 HMAC 密钥 |
| `FILE_URL_TTL_SECONDS` | `3600` | 签名 URL 有效期 |
| `NODE_ENV` | - | `production` 时不在忘记密码响应中返回 `resetToken` |

`.env` 由 `src/config.ts` 零依赖读取，不覆盖已存在的环境变量。

## 目录

```
src/
  index.ts          启动 / 优雅退出
  app.ts            createApp：中间件顺序、路由挂载
  config.ts         环境变量
  db.ts             pg Pool、query/one/tx
  schema.sql        幂等建表
  migrate.ts        执行 schema.sql
  permissions.ts    读取 web/src/constant/permissions.json 并校验
  types.ts          行类型与 Express Request 扩展
  auth/password.ts  argon2id
  auth/session.ts   会话 Cookie、成员/权限校验、workspace 上下文
  auth/csrf.ts      双提交 CSRF 中间件
  lib/http.ts       统一包体 / 错误 / 参数校验 / requestId
  lib/audit.ts      审计写入（只追加）
  lib/mailer.ts     开发期邮件占位（控制台打印令牌）
  lib/storage.ts    本地落盘 + HMAC 签名 URL
  lib/validate.ts   邮箱 / 密码 / 注册 / 登录 / 文档 schema
  routes/           auth / workspaces / projects / assets / files / audit
  smoke.ts          进程内冒烟测试
```

## 接口

成功统一 `{ code: "OK", message: "", data, requestId }`；失败 `{ code, message, data?, requestId }`，`requestId` 同时放在 `x-request-id` 响应头。

### 认证

`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`、`POST /api/auth/verify-email`、`POST /api/auth/resend-verification`、`POST /api/auth/forgot-password`、`POST /api/auth/reset-password`、`GET /api/auth/sessions`、`DELETE /api/auth/sessions/:id`。

- 密码 argon2id；≥10 位且含字母与数字。
- 会话：`ic_session`（httpOnly / SameSite=Lax / Secure 由环境变量控制），7 天滑动；`remember=true` 30 天。
- `ic_csrf` 非 httpOnly，状态变更接口（非 GET）必须让 `x-csrf-token` 与 Cookie 相同。
- 连续 5 次登录失败锁定 15 分钟，返回 429 `LOCKED` + `retryAfter`（同时带 `retry-after` 头）。
- 重复邮箱注册统一返回 200 `{pending:true}`，不创建第二个账号、不下发会话。
- 注册自动创建「{昵称}的空间」并把注册人设为 owner；带有效邀请时同时加入邀请空间。

### 空间 / 成员 / 角色 / 邀请

`GET/POST /api/workspaces`、`GET/PATCH/DELETE /api/workspaces/:id`、`POST /api/workspaces/:id/transfer-owner`、`GET /api/workspaces/:id/members`、`PATCH/DELETE /api/workspaces/:id/members/:userId`、`GET/POST /api/workspaces/:id/invitations`、`DELETE /api/workspaces/:id/invitations/:id`、`GET /api/invitations/:token`、`POST /api/invitations/:token/accept`、`GET /api/workspaces/:id/roles`、`PATCH /api/workspaces/:id/roles/:key`。

- 非成员访问空间统一 404；缺权限点 403 `PERMISSION_DENIED` 且带 `missingPermission`。
- 未验证邮箱访问空间内接口返回 403 `EMAIL_NOT_VERIFIED`（认证接口与创建个人空间除外）。
- 角色编辑只允许 editor / viewer / guest（owner/admin 不可编辑）；非 owner 不能授予自己没有的权限点。
- 不能修改自己的角色；只有 owner 能授予/调整 owner；不能移除或降级最后一个 owner；转让后原 owner 降为 admin。
- 创建邀请返回 `{invitation, token, inviteUrl:"/invite/<token>"}`；邀请默认 7 天、1 次使用。

### 项目 / 素材 / 文件 / 审计 / 迁移

`GET/POST /api/workspaces/:id/projects`、`GET/PUT/DELETE /api/projects/:id`、`POST/DELETE /api/projects/:id/collaborators[/:userId]`、`GET/POST /api/workspaces/:id/assets`、`PATCH/DELETE /api/assets/:id`、`POST /api/workspaces/:id/files?name=`、`GET /api/files/:key?exp=&sig=`、`GET /api/workspaces/:id/audit`、`POST /api/workspaces/:id/import`。

- 项目可见性 `private` / `workspace`：`private` 仅 owner 与协作者可见，其他人 404；`workspace` 空间成员按 `project.read`（guest 角色仍仅限自己的/协作的项目）。
- 保存使用 `{title?, doc, version}` 乐观锁，版本不一致返回 409 `VERSION_CONFLICT`，成功返回 `{version, updatedAt}`。
- 文件上传为原始二进制（≤200MB），返回 `{storageKey,url,bytes,mimeType}`；`url` 是带 `exp`/`sig` 的相对路径，HMAC-SHA256 校验。
- 审计只追加，支持 `action/actorId/from/to/limit/cursor`，`nextCursor` 为可排序 id 游标。
- 迁移接口逐项返回 `{created:[{index,type,id,title}],failed:[{index,reason}]}`，不做整体事务。

## 数据与安全

- 所有 id 使用 nanoid；时间为 `timestamptz`；会话与邀请只存令牌的 sha256。
- SQL 全部参数化；多步写入使用事务。
- 审计记录登录成功/失败、注册、空间创建/改名/解散/转让、成员邀请/改角色/移除、项目创建/保存/删除、素材创建/更新/删除、文件上传、迁移导入。
- 错误响应不返回堆栈；日志不打印密码、会话令牌或签名密钥。

## 与文档的偏差 / 未实现

1. 未实现 `POST /api/auth/refresh`：会话在每次请求滑动续期（7/30 天），没有独立刷新令牌轮换。
2. 登录失败与 CSRF 失败使用补充错误码：`INVALID_CREDENTIALS`、`CSRF_INVALID`、`TOKEN_INVALID`、`INVITATION_INVALID`、`SIGNATURE_INVALID`、`REGISTRATION_CLOSED`、`INVITATION_REQUIRED`、`LAST_OWNER`、`PAYLOAD_TOO_LARGE`、`METHOD_NOT_ALLOWED`；PRD 10.4 未定义的其余场景沿用其既有码。
3. 仅实现 5 个内置角色；自定义角色（PRD R-PERM-11）、角色预览、成员上限（默认 50）硬拦截未实现。
4. 项目列表一次返回空间内可见项目全集元数据，未分页；项目详情单独返回文档。
5. 邮箱验证/重置邮件只打印到控制台（开发占位），不接真实 SMTP；忘记密码在非 production 环境返回 `resetToken`。
6. 限流（resend-verification 3 次/小时、登录锁定）中，登录失败计数持久化在 `users`，重发验证计数为单实例内存。
7. 文件仅本地磁盘 + 单文件直传，未做分片/断点续传/对象存储。
8. 删除空间为软删除（`deleted_at`），成员与项目数据保留；删除项目同样软删除，未实现 30 天恢复界面。
9. 素材/文件 ACL 按空间成员 + `asset.*` 权限，`private` 素材仅 owner 可见；未实现 `link` 分享与访客只读页。
10. `dist/migrate.js` 读取 `src/schema.sql`（tsc 不复制 .sql），因此从其他目录运行 migrate 时需保证 `canvas-api/src/schema.sql` 存在。

## 冒烟测试覆盖

注册（邮箱小写、自动建空间）→ me → 建邀请 → 第二账号带邀请注册 → 角色列表 → 改角色 → 建项目 → 保存 → 版本冲突 409 → 文件上传/签名读取/错误签名 403 → 素材创建/列表 → 审计列表 → 权限拒绝（viewer 建项目 403、private 项目 404）→ 公开邀请信息 → 登出后 401。失败退出码 1，成功打印 `SMOKE OK`。
