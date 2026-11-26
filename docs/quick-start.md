# 快速开始

项目有两种运行方式，按需要选择：

| 方式 | 额外依赖 | 能做什么 |
| --- | --- | --- |
| 纯前端 | Bun | 画布、AI 生成、素材、提示词库；项目数据和 AI Key 都在浏览器本地 |
| 团队模式 | PostgreSQL + canvas-api | 账号、空间、成员与角色、项目云端保存、只读态 |

团队模式是在纯前端基础上加服务端，纯前端功能不受影响。不想手动准备 Node 与 PostgreSQL 时，可以直接用文末的团队模式 Compose 一条命令启动。

## 环境要求

- Node.js 20+（推荐 22，canvas-api 要求 `>=20`）
- Bun 1.3+（`web/` 用 Bun 安装、开发与构建）
- PostgreSQL 14+（仅团队模式）
- Docker（可选，一键跑前端镜像）

## 纯前端：本地启动

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas/web
bun install
bun run dev
```

访问 `http://localhost:3000`，右上角「配置」填入自己的 `Base URL`、`API Key` 和模型即可开始。

- 画布项目、素材、生成记录、AI Key 默认只存在浏览器本地。
- 提示词库由浏览器直连拉取并缓存到 IndexedDB。
- 常用脚本：`bun run build`、`bun run test`、`bun run format:check`。

## 团队模式：再加 canvas-api 与数据库

### 1. 启动 Postgres

本机已安装 PostgreSQL 命令行工具（或在 `PG_BIN` 指向安装目录）时，仓库自带脚本会初始化并启动一个开发库：

```bash
# 端口 55432，数据在 .dev/pgdata，库名 infinite_canvas，用户 postgres（trust 认证）
node scripts/dev-db.mjs start
node scripts/dev-db.mjs status
node scripts/dev-db.mjs stop
```

也可以用 Docker 或已有实例，重点是准备 `DATABASE_URL`：

```bash
docker run -d --name canvas-pg -p 55432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=infinite_canvas postgres:17
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/infinite_canvas
```

### 2. 构建并启动 canvas-api

```bash
cd canvas-api
npm install --ignore-scripts
npm run build      # tsc 产物在 dist/
npm run migrate    # 幂等建表，可重复执行
npm start          # http://127.0.0.1:8787
```

需要改端口、数据库或前端来源时，复制 `.env.example` 为 `canvas-api/.env` 再改；不创建时使用默认值。

### 3. 启动前端

Vite 开发服务器已把 `/api` 代理到 `http://127.0.0.1:8787`（可用 `VITE_API_PROXY` 覆盖），前端同源访问即可：

```bash
cd web
bun install
bun run dev
```

打开 `http://localhost:3000` 注册账号。默认 `AUTO_VERIFY_EMAIL=true`，注册即视为邮箱已验证；设为 `false` 时验证令牌会打印在 canvas-api 控制台。

团队模式下渠道与 API Key 由服务端托管：进入空间后在「模型」页新建渠道、拉取模型并配置授权配额，成员在画布里的生成请求会走 `/v1/gateway`（Vite 与 `nginx.team.conf` 都已配好反代），不再需要各自填写 Key。细节见[模型管理](model-management.md)。

### 4. 冒烟测试（可选）

```bash
cd canvas-api
npm test           # 进程内起服务，跑注册/空间/邀请/项目/文件/审计全链路，成功输出 SMOKE OK
```

## Docker

```bash
docker compose up -d                                       # 纯前端，发布镜像，http://localhost:3000
docker compose -f docker-compose.local.yml up -d --build   # 纯前端，本地构建镜像，http://localhost:3001
docker compose -f docker-compose.team.yml up -d --build    # 团队模式，连接已有 PostgreSQL，http://localhost:3000
```

前两个只启动静态前端；`docker-compose.team.yml` 会额外启动 canvas-api，并连接 `.env` 里 `DATABASE_URL` 指向的已有 PostgreSQL（不启动数据库容器，也不自动建表）。使用前先在仓库根目录用 `.env.example` 建 `.env` 并填好 `DATABASE_URL`。生产环境变量、HTTPS 与备份见[部署文档](deployment.md)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 端口被占用 | 前端默认 3000，canvas-api 默认 8787（`PORT`），Postgres 开发库 55432 |
| 生成请求被跨域拦截 | 纯前端模式由浏览器直连 AI 服务，属于对方 CORS；可用 [canvas-proxy](../canvas-proxy/README.md) 本机转发 |
| 团队接口 404 | 确认访问的是 Vite 开发服务器（带 `/api` 代理），或部署时已把 `/api` 反代到 canvas-api |
| 团队模式生成返回 404 或 `MODEL_NOT_GRANTED` | 前者检查 `/v1/gateway` 是否也反代到 canvas-api；后者在「模型」页给当前角色/成员授权该模型并勾选对应入口 |
| 登录后刷新变 401 | `APP_ORIGIN` 与实际访问来源不一致；HTTPS 部署要同时设 `SESSION_COOKIE_SECURE=true` |
| 找不到 `psql` / `pg_ctl` | 安装 PostgreSQL 并加入 PATH，或设置 `PG_BIN` 指向其 bin 目录 |
| 迁移后没有新表 | `npm run migrate` 依赖 `dist/`，先 `npm run build`；脚本读取 `src/schema.sql`，需要在 canvas-api 目录下运行 |
