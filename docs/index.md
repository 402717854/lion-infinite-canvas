# Infinite Canvas 文档索引

> 给 AI 与维护者使用的入口。文档为仓库内纯 Markdown，路径相对 `docs/`。

## 入口

- [快速开始](quick-start.md)：本地跑起来（纯前端 / 团队模式）
- [部署](deployment.md)：Docker、源码构建、Vercel、Render、canvas-api + PostgreSQL 全栈
- [待办](todo.md)：后续要做的事
- [待测试](pending-test.md)：已实现但仍需人工验证的清单

## 相关文档

- [CHANGELOG](../CHANGELOG.md) · [VERSION](../VERSION)
- [canvas-api 接口与实现说明](../canvas-api/README.md)
- [本地 Canvas Agent](../canvas-agent/README.md)
- [本地转发代理 canvas-proxy](../canvas-proxy/README.md)
- [画布插件与 SDK](../plugins/infinite-canvas/README.md)
- [漏洞提交](../SECURITY.md)

## 写文档时必须遵守的事实

- 纯前端模式下，画布项目、「我的素材」、生成记录和 AI API Key 都存在浏览器本地（IndexedDB / localforage）；不要写成已支持云同步。
- 团队模式下，项目文档、素材元数据、会话与审计在 canvas-api + PostgreSQL；登录不会替换浏览器里的本地数据，迁移是复制而不是移动。
- AI API Key 由浏览器持有并直连 OpenAI 兼容接口，不经过 canvas-api；canvas-proxy 只做本机转发。
- 邮箱验证与找回密码目前没有 SMTP，令牌打印在 canvas-api 控制台。
- 前端镜像只包含静态前端；团队模式可用 `docker-compose.team.yml` 一次构建前端与 canvas-api 镜像并连接已有的 PostgreSQL（不启动数据库容器），也可以分别部署 canvas-api 与 PostgreSQL。
- 文档不写会过期的日期，除非用户明确要求记录时间。
