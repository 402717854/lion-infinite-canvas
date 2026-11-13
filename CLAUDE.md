# CLAUDE.md — AI 执行规则

## 项目速览

**无限画布（infinite-canvas）**：面向图片创作的开源工作台，集画布编排、AI 图片生成、参考图编辑、对话助手、提示词库和素材沉淀于一体。

**技术栈**（前端代码在 `web/` 目录）
- Vite 7 + React 19 + TypeScript + React Router 7
- UI：Ant Design 6 + Tailwind CSS 4 + lucide-react
- 状态：Zustand；数据持久化：localforage（IndexedDB）
- 包管理：bun；本地开发：`cd web && bun install && bun run dev`（端口 3000）

**目录结构**
| 目录 | 职责 |
|---|---|
| `web/src/pages/` | 路由页面 |
| `web/src/components/` | 组件 |
| `web/src/stores/` | 全局状态（Zustand） |
| `web/src/services/` | 外部服务请求（浏览器直连） |
| `web/src/hooks/` | 全局 hooks |
| `web/src/lib/` | 工具函数与配置 |
| `canvas-agent/` | 本地 Canvas Agent（连接 Codex / Claude Code 操作画布） |
| `docs/` | 项目文档 |
| `PRD/` | 需求文档与 AI 修改日志 |

---

## 强制规则

### 1. AI 修改的所有代码必须添加中文注释

- 业务模块、函数、复杂逻辑块添加块注释，说明用途。
- 可人工调整的关键配置、参数单独注释：含义、合理取值范围、修改带来的影响、注意事项。
- 注释语言为中文，简洁明了，与代码逻辑对齐，方便后续人工阅读、排查和调整参数。
- 不写无意义冗余注释，只写对人工维护有用的信息。

### 2. AI 修改日志（每次对话结束后必写，无一例外）

**存放位置**：`PRD/AI修改日志/`

**目录结构**：
```
PRD/AI修改日志/
├── 202611/          # 月份文件夹，命名 YYYYMM
│   └── 13.md        # 日期文件，命名 dd.md
```

**规则**：
- 月份文件夹不存在时自动创建；日期文件不存在时自动创建。
- 同一天的多次对话追加到同一个日期文件，不覆盖。
- 日志只记录代码修改情况：修改了哪些文件、每个文件的哪些功能被修改。不写其他内容。

**日志条目模板**：
```markdown
## 需求标题

- **修改文件**：
  - `path/to/file1`：<修改了什么功能，简述>
  - `path/to/file2`：<修改了什么功能，简述>
```
