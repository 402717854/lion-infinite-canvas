# 部署

## 1. 架构

| 组件 | 作用 | 什么时候需要 |
| --- | --- | --- |
| 静态前端（`web/dist`） | 画布界面；本地模式下 AI 请求由浏览器直连用户自己的 OpenAI 兼容接口 | 总是 |
| nginx（镜像内） | 提供静态文件、SPA 回退、运行期 `config.js` | 总是 |
| canvas-api | 账号、空间、成员角色、项目/素材云端存储、审计、模型网关 | 团队模式 |
| PostgreSQL | 会话、成员、项目文档、文件元数据、审计、渠道密钥密文与用量 | 团队模式 |

- 纯前端部署只有一个静态站点，没有服务端数据。
- 团队模式把 `/api` 与 `/v1/gateway` 反代到 canvas-api，前端仍按同源路径访问。
- 团队模式下渠道与 API Key 只存在服务端（密文 + 掩码回显），生成请求经 `/v1/gateway/**` 转发并按授权与配额计量。
- 素材和文件落在 canvas-api 的 `DATA_DIR`，读取走带过期时间的 HMAC 签名 URL。

## 2. 环境变量

### 构建期（web）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VITE_BASE` | `/` | 部署在子路径时改为 `/sub/` |
| `VITE_API_BASE` | 空 | 为空表示同源 `/api`；canvas-api 单独域名时填完整地址 |
| `VITE_ANALYTICS_GA4_ID` | 空 | 构建期注入 GA4 ID，可被运行期覆盖 |
| `VITE_ANALYTICS_BAIDU_ID` | 空 | 构建期注入百度统计 ID |
| `VITE_API_PROXY` | `http://127.0.0.1:8787` | 仅 `bun run dev` 的 `/api` 代理目标 |

### 运行期（容器）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ANALYTICS_GA4_ID` | 空 | 容器启动时写入 `/config.js` |
| `ANALYTICS_BAIDU_ID` | 空 | 同上 |

`config.js` 在 nginx 中设为 `no-store`，改环境变量后重启容器即可生效，不用重新构建镜像。

### canvas-api（团队模式）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | API 端口 |
| `DATABASE_URL` | `postgres://postgres@127.0.0.1:55432/infinite_canvas` | Postgres 连接串 |
| `APP_ORIGIN` | `http://127.0.0.1:3000` | CORS 白名单，多个用逗号分隔 |
| `SESSION_COOKIE_SECURE` | `false` | HTTPS 生产环境必须置 `true` |
| `REGISTRATION_MODE` | `open` | `open` / `invite` / `closed` |
| `AUTO_VERIFY_EMAIL` | `true` | 目前没有 SMTP，生产建议保持 `true` |
| `DATA_DIR` | `data/uploads` | 素材/文件落盘目录（相对 canvas-api） |
| `FILE_URL_SECRET` | 开发默认值 | 签名 URL 的 HMAC 密钥，生产必须替换 |
| `FILE_URL_TTL_SECONDS` | `3600` | 签名 URL 有效期 |
| `APP_ENCRYPTION_KEY` | 无 | 渠道 API Key 的 AES-256-GCM 加密密钥；`NODE_ENV=production` 时缺失会启动失败，开发缺失用固定 dev key 并打印警告 |
| `NODE_ENV` | - | `production` 时忘记密码接口不返回 `resetToken` |

### 全栈 Compose（`docker-compose.team.yml`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `3000` | 前端映射到宿主机的端口 |
| `DATABASE_URL` | 无（必填） | PostgreSQL 连接串，容器访问宿主机用 `host.docker.internal:5432` |
| `APP_ORIGIN` | `http://localhost:3000` | 实际访问来源，HTTPS 时写 `https://...` |
| `SESSION_COOKIE_SECURE` | `false` | HTTPS 部署必须置 `true` |
| `REGISTRATION_MODE` | `open` | `open` / `invite` / `closed` |
| `AUTO_VERIFY_EMAIL` | `true` | 没有 SMTP 时保持 `true` |
| `FILE_URL_SECRET` | 开发默认值 | 生产必须换成随机长字符串 |
| `APP_ENCRYPTION_KEY` | 无（必填） | 渠道 API Key 的加密密钥，`NODE_ENV=production` 下缺失会启动失败；多实例必须一致 |

这些变量写在仓库根目录的 `.env` 中由 Compose 读取；`DATABASE_URL` 必填，其余不建 `.env` 时使用上表默认值。

## 3. 方式一：Docker Compose（前端）

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas
docker compose up -d
```

访问 `http://localhost:3000`。默认使用 `ghcr.io/basketikun/infinite-canvas:latest`。

启用统计时在 `docker-compose.yml` 的 `environment` 中填 ID，或用 `docker run`：

```bash
docker run -d -p 3000:3000 \
  -e ANALYTICS_GA4_ID=G-XXXXXXXXXX \
  -e ANALYTICS_BAIDU_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  ghcr.io/basketikun/infinite-canvas:latest
```

不填则完全不加载统计脚本、不发任何外部请求。

## 4. 方式二：源码构建镜像

```bash
# 本地构建，宿主端口 3001
docker compose -f docker-compose.local.yml up -d --build

# 或者直接 docker
docker build -t infinite-canvas .
docker run --rm -p 3000:3000 infinite-canvas
```

镜像构建会复制仓库根目录的 `VERSION` 与 `CHANGELOG.md`（前端版本弹窗需要），缺少任意一个都会构建失败。前端构建阶段读取这两个文件，所以不要把它们写进 `.dockerignore`。

## 5. 方式三：Vercel

在 Vercel 导入仓库即可，根目录 `vercel.json` 已指定：

- 安装：`cd web && bun install`
- 构建：`cd web && bun run build`
- 输出：`web/dist`
- 所有路径重写到 `index.html`（SPA）

AI 请求由浏览器直连，纯前端部署不需要服务端变量。

团队模式需要 canvas-api 的 HTTPS 域名，并把 `VITE_API_BASE` 设成它；但会话 Cookie 是 `SameSite=Lax`，跨站请求不会携带 Cookie，因此推荐把 `/api` 反代到同域，而不是跨域直连。

## 6. 方式四：Render

`render.yaml` 使用 Docker 运行时，服务端口 `3000`，健康检查 `/`。

免费实例空闲约 15 分钟后休眠，下次访问自动唤醒，适合演示；需要稳定在线时用付费实例或换其他平台。

## 7. 团队模式：全栈 Compose（源码构建）

`docker-compose.team.yml` 会把前端和后端都从源码构建成镜像，数据库连接已有的 PostgreSQL（本机或远程实例），不启动数据库容器，也不在 `up` 时自动建表：

- `web`：仓库根目录的 `Dockerfile`，`bun run build` 后由 nginx 提供静态文件；
- `api`：`canvas-api/Dockerfile`，多阶段构建，运行 `node dist/index.js`，通过 `DATABASE_URL` 连接数据库。

`nginx.team.conf` 挂载到前端容器，把 `/api` 同源反代到 `api:8787`。canvas-api 镜像内会把前后端共用的 `web/src/constant/permissions.json` 复制到 `/app/web/src/constant/`（权限模块按仓库目录读取），并以非 root 的 `node` 用户运行。

仓库根目录提供了 `.env.example`，复制为 `.env` 后填写（`.env` 已被 Git 忽略）：

```bash
cp .env.example .env
```

```bash
WEB_PORT=3000
DATABASE_URL=postgres://用户:密码@host.docker.internal:5432/infinite_canvas
APP_ORIGIN=https://canvas.example.com
SESSION_COOKIE_SECURE=true
FILE_URL_SECRET=<随机长字符串>
APP_ENCRYPTION_KEY=<随机长字符串>
REGISTRATION_MODE=invite
```

`DATABASE_URL` 必填，未设置时 Compose 直接报错。容器访问宿主机上的 PostgreSQL 用 `host.docker.internal`：Docker Desktop 自带解析，Linux 需要在 `api` 服务加 `extra_hosts: ["host.docker.internal:host-gateway"]`。宿主机上的 PostgreSQL 还要允许 Docker 网段连接（`listen_addresses` 不能只绑定回环地址，`pg_hba.conf` 要放行如 `172.16.0.0/12`），否则容器能解析地址也会认证失败。连接远程实例时直接写实际主机和端口。密码含 `@`、`:`、`/` 等字符时要按 URL 编码。

```bash
docker compose -f docker-compose.team.yml up -d --build
```

也可以单独构建两个镜像。canvas-api 的构建上下文必须是仓库根目录，因为镜像需要 `web/src/constant/permissions.json`：

```bash
docker build -t infinite-canvas-web:local .
docker build -t infinite-canvas-api:local -f canvas-api/Dockerfile .
```

启动顺序：`api` 健康 → `web`。访问 `http://localhost:3000` 注册账号。

数据库表由外部数据库提供。首次使用空库或 `canvas-api/src/schema.sql` 有变更时，手动执行一次迁移（幂等）：

```bash
docker compose -f docker-compose.team.yml run --rm --build api node dist/migrate.js
```

数据落点：`uploads` 卷对应 canvas-api 的 `/data/uploads`。

```bash
docker volume ls | grep infinite-canvas-team
```

升级：

```bash
git pull
docker compose -f docker-compose.team.yml up -d --build
```

如果本次升级改了表结构，再执行上面的迁移命令。

日志与状态：

```bash
docker compose -f docker-compose.team.yml ps
docker compose -f docker-compose.team.yml logs -f api
```

生产环境在前面再放一层 HTTPS 反向代理（Caddy、Traefik 或云负载均衡），把 443 转到 3000；同时按上表设置 `APP_ORIGIN`、`SESSION_COOKIE_SECURE=true` 和随机 `FILE_URL_SECRET`。

## 8. 团队模式部署：canvas-api + PostgreSQL

### 8.1 准备数据库

任意 PostgreSQL 14+。首次部署执行建表（幂等，可重复执行）：

```bash
cd canvas-api
npm install --ignore-scripts
npm run build
DATABASE_URL=postgres://user:pass@db:5432/infinite_canvas npm run migrate
```

### 8.2 运行 canvas-api

```bash
NODE_ENV=production \
PORT=8787 \
DATABASE_URL=postgres://user:pass@db:5432/infinite_canvas \
APP_ORIGIN=https://canvas.example.com \
SESSION_COOKIE_SECURE=true \
FILE_URL_SECRET=<随机长字符串> \
APP_ENCRYPTION_KEY=<随机长字符串> \
DATA_DIR=/data/uploads \
node dist/index.js
```

- 持久化两处数据：Postgres 数据卷和 `DATA_DIR`；丢掉任意一个都会丢素材或云端项目。
- 多实例时 `FILE_URL_SECRET` 必须一致（会话已存 Postgres，可水平扩展）。
- 升级先执行 `npm run migrate`，再重启进程。

### 8.3 nginx 反代 `/api` 与 `/v1/gateway`

前端容器与 canvas-api 可以分开跑，让 nginx 把 `/api` 与 `/v1/gateway` 转给 canvas-api，其余走静态文件。仓库根目录的 `nginx.team.conf` 就是这份配置（上游写成 `api:8787`），Compose 会把它挂载到前端容器；单独部署时复制该文件并按实际上游地址调整：

```nginx
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 模型网关：SSE 需要关闭缓冲
    location /v1/gateway/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location = /config.js {
        add_header Cache-Control "no-store";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

注意：

- `proxy_pass` 末尾不要加斜杠，否则 `/api` 前缀会被截掉。
- `client_max_body_size` 要大于单文件上限（canvas-api 允许 200MB；网关的图片编辑上限 25MB）。
- `/v1/gateway/` 必须关闭 `proxy_buffering`，否则画布助手的 SSE 回复会被一次性吐出。
- 前端同源访问 `/api` 与 `/v1/gateway` 时不需要 `VITE_API_BASE`，Cookie 与 CSRF 行为与开发环境一致。

### 8.4 HTTPS 与 Cookie

- 生产必须用 HTTPS，并设 `SESSION_COOKIE_SECURE=true`。
- `APP_ORIGIN` 写实际访问来源（含协议和端口），CORS 只放行该来源。
- 会话 Cookie `ic_session` 是 `httpOnly` + `SameSite=Lax`，7 天滑动，勾选「记住我」30 天；CSRF 用 `ic_csrf` 双提交，前端自动带 `x-csrf-token`。

### 8.5 备份与恢复

```bash
pg_dump "$DATABASE_URL" > backup.sql
tar czf uploads.tgz -C canvas-api data/uploads
```

恢复时先导入 SQL，再把 `data/uploads` 放回 `DATA_DIR`，最后启动 canvas-api。

## 9. 安全清单

- `FILE_URL_SECRET` 换成随机长字符串；默认值等于公开密钥，能被用来伪造素材下载链接。
- `APP_ENCRYPTION_KEY` 必须设置成随机长字符串并妥善保管：渠道 API Key 用它做 AES-256-GCM 加密入库，换掉后旧密文无法解密，需要重新填写渠道密钥。
- 生产开 HTTPS + `SESSION_COOKIE_SECURE=true`，按需把 `REGISTRATION_MODE` 改为 `invite` 或 `closed`。
- 目前没有 SMTP：邮箱验证/重置密码的令牌只打印在 canvas-api 控制台。要么保持 `AUTO_VERIFY_EMAIL=true`，要么先接入邮件服务再关闭。
- 本地模式下 AI API Key 存在浏览器本地，由浏览器直连用户自己的接口；团队模式下渠道与 Key 只存在服务端，接口只回掩码，生成请求经 `/v1/gateway` 转发，不要把 Key 写进前端配置或日志。
- canvas-api 不要不设 `APP_ORIGIN` 就暴露到公网；错误响应不返回堆栈，但 CORS 与 Cookie 仍需正确配置。
- 素材 URL 带过期时间，过期后需要重新获取，不要把签名 URL 当永久链接保存。

## 10. 故障排查

| 现象 | 排查方向 |
| --- | --- |
| 构建报 `ENOENT` 找不到 `VERSION` 或 `CHANGELOG.md` | 仓库根目录缺文件，或 `.dockerignore` 把它们排除了 |
| 容器已启动但 3000 打不开 | 确认 nginx 监听端口与 compose 映射一致（镜像内为 3000） |
| 页面能开，接口全 404 | 生产环境没有把 `/api` 反代到 canvas-api，或 `VITE_API_BASE` 写错 |
| 生成请求 404 | 没有把 `/v1/gateway` 反代到 canvas-api（或 `VITE_API_BASE` 指向的地址缺少该前缀） |
| 画布助手回复一次性出现 | 反代没有对 `/v1/gateway/` 关闭 `proxy_buffering` |
| 登录成功，刷新后 401 | `APP_ORIGIN` 不匹配、HTTPS 下未设 `SESSION_COOKIE_SECURE`、或跨站访问导致 Cookie 不发送；用 HTTP 访问时若 `SESSION_COOKIE_SECURE=true`，`Set-Cookie` 带 `Secure` 会被浏览器直接丢弃，同样表现为登录后一直 401 |
| 上传大文件失败 | 反向代理的 `client_max_body_size` 小于 200MB |
| 素材 403 `SIGNATURE_INVALID` | 签名过期，或 `FILE_URL_SECRET` 与签发时不一致 |
| 忘记密码没有返回链接 | `NODE_ENV=production` 时不返回 `resetToken`，令牌只打印在服务端控制台 |
| 启动报 `set DATABASE_URL in .env` | 根目录缺 `.env` 或没有设置 `DATABASE_URL`，按第 7 节填写 |
| `api` 一直 unhealthy、前端 502 | 看 `logs api`；确认 `DATABASE_URL` 能连通、库已建表（先执行第 7 节的迁移命令）；宿主机上的库要放行 Docker 网段 |
| 上传文件报 `EACCES` | `uploads` 改成了 bind mount 且宿主机目录属主不是容器内 `node`（uid 1000），执行 `chown -R 1000:1000 <目录>` |
| 全栈 Compose 端口冲突 | 在根目录 `.env` 改 `WEB_PORT`，同时把 `APP_ORIGIN` 改成新端口 |
| Render 首次访问很慢 | 免费实例休眠后冷启动 |
