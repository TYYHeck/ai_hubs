# AI Hubs v4.0 — 完整重构蓝图

> **定位**：打造类似 CodeBuddy 的产品级 AI Agent 平台，多端一致、体验流畅、功能完整。
> **原则**：质量最优先，不偷懒设计，完全按照需求文档实现，每次改动先提交 Git。

---

## 一、技术栈选型（推荐）

### 后端：Python 3.12 + FastAPI + SQLAlchemy 2.0

| 层 | 技术 | 理由 |
|----|------|------|
| **运行时** | Python 3.12 | AI 生态最完善，LangChain/LangGraph 原生支持 |
| **Web 框架** | FastAPI | 异步高性能、自动 OpenAPI 文档、依赖注入、SSE/WebSocket 原生 |
| **ORM** | SQLAlchemy 2.0 (async) | 成熟、支持 MySQL + SQLite 双驱动切换 |
| **数据库** | MySQL 8.0（服务器）+ SQLite（桌面端/本地） | 自动切换：检测到 MySQL 可用就用 MySQL，否则回退 SQLite |
| **向量库** | ChromaDB（嵌入式） | 纯 Python，无需独立服务，桌面端零配置 |
| **AI 框架** | LangChain + LangGraph | ReAct Agent、流式、工具调用的事实标准 |
| **任务队列** | asyncio + 后台线程（轻量）/ Celery（可选重型） | 单进程内调度足够，避免引入 Redis 依赖 |
| **认证** | JWT (python-jose) + 原生 bcrypt（不依赖 passlib） | 无状态、多端通用 |
| **邮件** | smtplib + QQ邮箱 SMTP | 验证码发送，需求指定 3526145827@qq.com |
| **测试** | pytest + pytest-asyncio + httpx (AsyncClient) | 异步测试、API 集成测试 |

### 前端：React 18 + TypeScript + Vite + Tailwind CSS

| 层 | 技术 | 理由 |
|----|------|------|
| **框架** | React 18 | 生态最成熟，团队熟悉 |
| **语言** | TypeScript 5 | 类型安全，重构必需 |
| **构建** | Vite 5 | 极速 HMR，生产构建快 |
| **样式** | Tailwind CSS 3 + shadcn/ui | 原子化 + 高质量组件库，快速做出产品级 UI，不偷懒 |
| **状态** | Zustand | 轻量、TypeScript 友好、无 boilerplate |
| **路由** | React Router 6 | SPA 标配 |
| **请求** | 原生 fetch + SSE（流式）| 不引入 axios，减少依赖 |
| **代码编辑器** | Monaco Editor（@monaco-editor/react）| VS Code 同款内核，内置 IDE 需求 |
| **图表** | Recharts | 仪表盘数据可视化 |
| **图标** | Lucide React | 简洁、统一、不 AI 风格 |

### 桌面端：Electron 28

| 层 | 技术 | 理由 |
|----|------|------|
| **壳** | Electron 28 | 跨平台，自包含后端 Python 进程 |
| **打包** | electron-builder | win=nsis, mac=dmg, linux=AppImage |
| **后端嵌入** | spawn python 子进程 | 桌面端零配置：内置 SQLite + ChromaDB |

### CLI：Python (Rich + Prompt Toolkit)

| 层 | 技术 | 理由 |
|----|------|------|
| **终端 UI** | Rich | 美观的终端渲染（Markdown、表格、语法高亮） |
| **输入** | Prompt Toolkit | 上下箭头回溯、自动补全、多行编辑 |
| **框架** | Typer | 类型安全的 CLI 框架，自动生成 help |

### 基础设施

| 项 | 技术 |
|----|------|
| **包管理(后端)** | uv（比 pip 快 10-100x）或 pip + requirements.txt |
| **包管理(前端)** | pnpm（比 npm 快、省磁盘） |
| **代码质量(后端)** | ruff（lint+format）+ mypy（类型检查） |
| **代码质量(前端)** | eslint + prettier |
| **CI/CD** | GitHub Actions（lint + test + build） |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     用户接入层                            │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │  CLI端   │  │  Web端(Nginx) │  │  桌面端(Electron)  │ │
│  │ Rich+Typer│  │  React SPA   │  │  React + 内置Python│ │
│  └────┬─────┘  └──────┬───────┘  └─────────┬──────────┘ │
│       │               │                     │            │
│       └───────────────┼─────────────────────┘            │
│                       │ HTTP / SSE / WebSocket            │
└───────────────────────┼─────────────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────────────┐
│              API 网关层 (FastAPI)                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  认证中间件 → 限流中间件 → CORS → 路由分发           │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬───┐ │
│  │auth  │chat  │agent │task  │skill │memory│dataset│ide│ │
│  │router│router│router│router│router│router│router │rtr│ │
│  └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴┬──┴┘ │
└─────┼──────┼──────┼──────┼──────┼──────┼──────┼─────┼────┘
      │      │      │      │      │      │      │     │
┌─────┼──────┼──────┼──────┼──────┼──────┼──────┼─────┼────┐
│     │   核心引擎层 (Domain)                                 │
│  ┌──▼──────────────────────────────────────────────────┐  │
│  │  AgentEngine (LangGraph ReAct)                       │  │
│  │  ├── LLMManager (5 providers, 快速/详细配置)         │  │
│  │  ├── Orchestrator (8种协作模式)                      │  │
│  │  ├── ToolRegistry (内置+扩展工具)                    │  │
│  │  └── SkillLoader (动态加载技能)                      │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │  MemoryEngine                                         │  │
│  │  ├── ShortTerm (滑动窗口+摘要)                       │  │
│  │  ├── LongTerm (ChromaDB 向量)                        │  │
│  │  ├── VCSMemory (git式 commit/checkout/diff)         │  │
│  │  ├── MemoryGraph (关键词图谱索引)                    │  │
│  │  └── Compressor (高无损压缩)                         │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │  RAGEngine (知识库检索增强)                          │  │
│  │  TaskManager (生命周期+调度+暂停恢复)                │  │
│  │  WorkflowEngine (可视化工作流编排)                   │  │
│  └─────────────────────────────────────────────────────┘  │
└─────┬──────┬──────┬──────┬──────┬──────┬──────┬─────┬────┘
      │      │      │      │      │      │      │     │
┌─────▼──────▼──────▼──────▼──────▼──────▼──────▼─────▼────┐
│                   数据持久层                              │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────────────┐ │
│  │ SQLAlchemy  │  │ ChromaDB │  │ 文件系统            │ │
│  │ MySQL/SQLite│  │ (向量)   │  │ skills/ datasets/   │ │
│  │ 自动切换    │  │ 嵌入式   │  │ uploads/ workspace/ │ │
│  └─────────────┘  └──────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 数据库自动切换逻辑

```python
# 启动时检测：优先 MySQL，回退 SQLite
def init_database():
    if os.getenv("DB_URL") or config.database.has_mysql():
        try:
            engine = create_async_engine("mysql+aiomysql://...")
            # 测试连接
            return engine  # MySQL 模式
        except ConnectionError:
            pass
    # 回退 SQLite（桌面端/本地开发零配置）
    sqlite_path = data_dir / "ai_hubs.db"
    return create_async_engine(f"sqlite+aiosqlite:///{sqlite_path}")
```

---

## 三、目录结构（全新）

```
ai_hubs/
├── backend/                         # 后端（Python）
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI 入口
│   │   ├── config.py                # 配置管理（YAML + 环境变量）
│   │   ├── database.py              # 数据库引擎（MySQL/SQLite 自动切换）
│   │   ├── models/                  # SQLAlchemy ORM 模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── agent.py
│   │   │   ├── task.py
│   │   │   ├── skill.py
│   │   │   ├── dataset.py
│   │   │   ├── memory.py
│   │   │   ├── conversation.py
│   │   │   └── system.py
│   │   ├── schemas/                 # Pydantic 请求/响应模型
│   │   │   ├── auth.py
│   │   │   ├── agent.py
│   │   │   ├── task.py
│   │   │   └── ...
│   │   ├── api/                     # API 路由
│   │   │   ├── __init__.py
│   │   │   ├── deps.py              # 依赖注入（认证、分页等）
│   │   │   └── v1/
│   │   │       ├── auth.py          # 注册/登录/验证码
│   │   │       ├── chat.py          # 对话（SSE 流式）
│   │   │       ├── agents.py        # Agent CRUD + 快速/详细配置
│   │   │       ├── tasks.py         # 任务 + 编排 + 暂停恢复
│   │   │       ├── skills.py        # 技能市场 + GitHub 检索
│   │   │       ├── memory.py        # 记忆 VCS + 图谱 + 压缩
│   │   │       ├── datasets.py      # 数据集管理
│   │   │       ├── knowledge.py     # RAG 知识库
│   │   │       ├── ide.py           # 内置 IDE（代码执行+插件）
│   │   │       ├── admin.py         # 后台管理
│   │   │       ├── settings.py      # 用户偏好/端设置
│   │   │       └── system.py        # 健康检查/指标/系统信息
│   │   ├── core/                    # 核心引擎
│   │   │   ├── agent.py             # LangGraph ReAct Agent
│   │   │   ├── llm.py               # LLM 管理（5 provider）
│   │   │   ├── orchestrator.py      # 8种编排模式
│   │   │   ├── task_manager.py      # 任务调度
│   │   │   └── workflow.py          # 工作流引擎
│   │   ├── memory/                  # 记忆系统
│   │   │   ├── short_term.py
│   │   │   ├── long_term.py
│   │   │   ├── vcs.py               # git式记忆版本控制
│   │   │   ├── graph.py             # 记忆图谱
│   │   │   └── compressor.py        # 压缩
│   │   ├── skills/                  # 技能系统
│   │   │   ├── manager.py
│   │   │   ├── github.py            # GitHub 技能检索
│   │   │   └── loader.py            # 动态加载
│   │   ├── tools/                   # 工具系统
│   │   │   ├── base.py
│   │   │   ├── builtin.py
│   │   │   └── extended.py
│   │   ├── rag/                     # RAG 引擎
│   │   │   └── knowledge_base.py
│   │   ├── services/                # 业务服务层
│   │   │   ├── auth_service.py
│   │   │   ├── email_service.py
│   │   │   ├── agent_service.py
│   │   │   └── ...
│   │   └── middleware/
│   │       ├── auth.py
│   │       └── rate_limit.py
│   ├── migrations/                  # 数据库迁移
│   │   └── alembic/                 # Alembic 迁移脚本
│   ├── tests/                       # 测试
│   │   ├── conftest.py
│   │   ├── test_auth.py
│   │   ├── test_chat.py
│   │   ├── test_agents.py
│   │   ├── test_tasks.py
│   │   ├── test_skills.py
│   │   ├── test_memory.py
│   │   └── ...
│   ├── pyproject.toml               # 依赖管理（uv/pip）
│   ├── alembic.ini
│   └── config.yaml                  # 应用配置
│
├── frontend/                        # 前端（React）
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── router.tsx               # 路由配置
│   │   ├── pages/                   # 页面组件
│   │   │   ├── AuthPage.tsx         # 登录/注册（固定框+邮箱验证码）
│   │   │   ├── DashboardPage.tsx    # 仪表盘
│   │   │   ├── ChatPage.tsx         # 对话（流式+思考+回溯+指令猜测）
│   │   │   ├── AgentsPage.tsx       # Agent管理（快速/详细配置）
│   │   │   ├── TasksPage.tsx        # 任务管理（编排+暂停恢复）
│   │   │   ├── SkillsPage.tsx       # 技能市场（GitHub检索+一键安装）
│   │   │   ├── MemoryPage.tsx       # 记忆查看（VCS+图谱）
│   │   │   ├── KnowledgePage.tsx    # 知识库管理
│   │   │   ├── DatasetsPage.tsx     # 数据集管理
│   │   │   ├── IdePage.tsx          # 内置IDE（Monaco+插件）
│   │   │   ├── WorkflowPage.tsx     # 工作流可视化编排
│   │   │   ├── AdminPage.tsx        # 后台管理
│   │   │   └── SettingsPage.tsx     # 设置（主题/字体/端配置）
│   │   ├── components/              # 通用组件
│   │   │   ├── ui/                  # shadcn/ui 基础组件
│   │   │   ├── layout/              # 布局（Sidebar/Header/等）
│   │   │   ├── chat/                # 对话相关组件
│   │   │   ├── agent/               # Agent 相关组件
│   │   │   └── shared/              # 共享组件
│   │   ├── stores/                  # Zustand 状态管理
│   │   │   ├── authStore.ts
│   │   │   ├── chatStore.ts
│   │   │   ├── agentStore.ts
│   │   │   └── ...
│   │   ├── api/                     # API 客户端
│   │   │   ├── client.ts            # 基础请求封装
│   │   │   ├── sse.ts               # SSE 流式处理
│   │   │   └── endpoints/           # 各模块 API
│   │   ├── hooks/                   # 自定义 Hooks
│   │   ├── types/                   # TypeScript 类型
│   │   ├── utils/                   # 工具函数
│   │   └── styles/                  # 全局样式
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── cli/                             # CLI 端
│   ├── ai_hubs_cli/
│   │   ├── __init__.py
│   │   ├── main.py                  # Typer 入口
│   │   ├── commands/                # 各命令
│   │   │   ├── chat.py
│   │   │   ├── agent.py
│   │   │   ├── task.py
│   │   │   ├── skill.py
│   │   │   └── config.py
│   │   ├── ui/                      # 终端 UI 渲染
│   │   │   ├── renderer.py          # Rich 渲染
│   │   │   └── input.py             # Prompt Toolkit 输入
│   │   └── client.py                # HTTP 客户端（连接后端）
│   └── pyproject.toml
│
├── electron/                        # 桌面端
│   ├── main.js                      # 主进程
│   ├── preload.js                   # 预加载
│   └── icon.png
│
├── deploy/                          # 部署配置
│   ├── nginx.conf
│   ├── ai_hubs.service
│   └── Dockerfile
│
├── docs/                            # 文档
├── package.json                     # Electron 配置
├── config.yaml                      # 全局配置
└── README.md
```

---

## 四、数据模型（完整）

### 4.1 关系型数据（MySQL/SQLite）

```sql
-- 用户
users (id, username, password_hash, email, role, is_active, preferences JSON, created_at, last_login_at)

-- 对话
conversations (id, user_id, title, agent_name, model, created_at, updated_at)
messages (id, conversation_id, role, content, think_content, tokens_used, created_at)

-- Agent
agents (id, user_id, name, description, system_prompt, model, provider, 
        skills JSON, tags JSON, category, setup_mode, max_iterations,
        enable_planning, enable_rag, enable_reflection, memory_strength,
        status, created_at, updated_at)

-- 任务
tasks (id, user_id, title, description, status, priority, tags JSON,
       assigned_agent, mode, think_depth, think_visibility,
       result, error, metadata JSON, created_at, started_at, finished_at)
task_events (id, task_id, event, data JSON, created_at)

-- 技能
skills (id, name, description, category, source, github_url, version,
        config JSON, is_installed, installed_at, created_at)

-- 数据集
datasets (id, user_id, name, description, category, schema JSON,
          record_count, created_at, updated_at)
dataset_records (id, dataset_id, data JSON, created_at)

-- 知识库
knowledge_sources (id, user_id, filename, source_type, chunk_count,
                   file_size, created_at)

-- 记忆（VCS）
memory_commits (id, user_id, agent_name, commit_hash, message,
                parent_hash, message_count, summary, created_at)
memory_snapshots (id, commit_id, data JSON)  -- 快照存储

-- 系统日志
system_logs (id, level, logger, message, extra JSON, trace_id, created_at)

-- 验证码
verification_codes (id, email, code, purpose, expires_at, used)
```

### 4.2 向量数据（ChromaDB）

```
collections:
  - long_term_memory    # 长期记忆（用户级）
  - knowledge_base      # RAG 知识库
  - agent_memory        # Agent 专属记忆（按 agent_name 分区）
```

### 4.3 文件系统

```
data/
├── skills/            # 已安装技能
│   ├── <skill_name>/
│   │   ├── skill.yaml
│   │   ├── handler.py
│   │   └── README.md
├── datasets/          # 数据集文件
├── uploads/           # 上传文件
├── workspace/         # IDE 工作区
└── chroma/            # ChromaDB 持久化
```

---

## 五、API 设计（RESTful + SSE + WebSocket）

### 5.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 注册（用户名+密码+确认+邮箱+验证码） |
| POST | `/api/v1/auth/login` | 登录 → JWT |
| POST | `/api/v1/auth/send-code` | 发送邮箱验证码 |
| GET | `/api/v1/auth/me` | 当前用户信息 |
| PUT | `/api/v1/auth/password` | 修改密码 |

### 5.2 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/conversations` | 对话列表 |
| POST | `/api/v1/conversations` | 创建对话 |
| DELETE | `/api/v1/conversations/{id}` | 删除对话 |
| POST | `/api/v1/chat/stream` | **SSE 流式对话**（思考+回复+工具调用事件） |
| GET | `/api/v1/chat/history/{conv_id}` | 历史消息 |
| WS | `/ws` | WebSocket 实时推送（任务状态等） |

### 5.3 Agent

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/agents` | Agent 列表 |
| POST | `/api/v1/agents` | 创建（quick/detailed 双模式） |
| PUT | `/api/v1/agents/{name}` | 更新 |
| DELETE | `/api/v1/agents/{name}` | 删除 |
| GET | `/api/v1/agents/{name}/config` | 获取配置 |
| POST | `/api/v1/agents/{name}/test` | 测试 Agent |

### 5.4 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tasks` | 任务列表 |
| POST | `/api/v1/tasks` | 创建任务 |
| POST | `/api/v1/tasks/orchestrate/stream` | **SSE 编排流**（8种模式） |
| POST | `/api/v1/tasks/{id}/pause` | 暂停 |
| POST | `/api/v1/tasks/{id}/resume` | 恢复 |
| POST | `/api/v1/tasks/{id}/cancel` | 取消 |
| GET | `/api/v1/tasks/modes` | 编排模式列表 |
| POST | `/api/v1/tasks/detect-mode` | AI 自动检测模式 |

### 5.5 技能

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/skills` | 已安装技能列表 |
| POST | `/api/v1/skills/install` | 安装技能 |
| DELETE | `/api/v1/skills/{id}` | 卸载 |
| PUT | `/api/v1/skills/{id}` | 修改 |
| GET | `/api/v1/skills/github/search` | GitHub 检索 |
| POST | `/api/v1/skills/github/import` | 从 GitHub 导入 |
| GET | `/api/v1/skills/categories` | 分类列表 |

### 5.6 记忆

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/memory/stats` | 记忆统计 |
| GET | `/api/v1/memory/vcs/log` | commit 历史 |
| POST | `/api/v1/memory/vcs/commit` | 提交记忆快照 |
| POST | `/api/v1/memory/vcs/checkout` | 回退到某版本 |
| POST | `/api/v1/memory/vcs/diff` | 对比两个版本 |
| GET | `/api/v1/memory/graph` | 记忆图谱数据 |
| POST | `/api/v1/memory/recall` | 召回记忆 |
| POST | `/api/v1/memory/compress` | 压缩记忆 |

### 5.7 其他

| 模块 | 关键端点 |
|------|---------|
| 数据集 | CRUD + 分类 + 导出 |
| 知识库 | 上传/搜索/统计/删除 |
| IDE | `/api/v1/ide/run` 代码执行, `/api/v1/ide/plugins` 插件管理 |
| 后台 | `/api/v1/admin/stats`, `/api/v1/admin/users` CRUD |
| 设置 | `/api/v1/settings` 偏好读写 |
| 系统 | `/health`, `/metrics`, `/api/v1/system/info` |

---

## 六、前端页面设计

### 6.1 设计原则（来自需求文档）

- **简洁不 AI 风**：配色克制，不要花哨渐变和发光效果
- **不偷懒**：每个功能都有完整 UI，不是占位
- **显隐分明**：优先级层级清晰，圆角只在合适处使用
- **固定登录框**：宽高不因内容变化，错误提示上方弹出
- **多端一致**：Web/CLI/桌面端功能齐全且数据同步

### 6.2 配色方案

```
/* 基于需求"简洁、不AI风" — 克制的深色主题 */
--bg-primary: #0f0f0f      /* 主背景 */
--bg-secondary: #1a1a1a    /* 卡片背景 */
--bg-tertiary: #242424     /* 悬浮元素 */
--border: #2a2a2a          /* 边框 */
--text-primary: #e5e5e5    /* 主文本 */
--text-secondary: #999     /* 次要文本 */
--accent: #3b82f6          /* 强调色（蓝） */
--accent-hover: #2563eb    /* 悬浮 */
--success: #22c55e
--warning: #f59e0b
--error: #ef4444
```

### 6.3 页面清单与核心交互

| 页面 | 核心交互 |
|------|---------|
| **登录/注册** | 固定框、邮箱验证码倒计时、密码强度提示、错误顶部 toast |
| **仪表盘** | Agent数/任务统计/模型状态/记忆量/知识库量、实时刷新 |
| **对话** | SSE流式输出、思考过程折叠展示、`[AgentName]`前缀、上下箭头回溯历史、`/`指令补全、对话内快捷管理Agent |
| **Agent管理** | 快速模式(选模型+一句话描述)/详细模式(全配置)、技能勾选、标签管理、数据库分类 |
| **任务管理** | 直接/AI分析、8种编排模式选择、思考深度/可见性滑块、暂停/恢复、实时日志流 |
| **技能市场** | 已安装/GitHub检索双视图、一键安装、分类筛选、技能创建 |
| **记忆** | VCS时间线、commit/checkout、图谱可视化、压缩、记忆强度配置 |
| **知识库** | 拖拽上传、搜索测试、chunk统计 |
| **数据集** | 分类管理、记录CRUD、导出JSON/CSV |
| **IDE** | Monaco编辑器、多语言执行、插件市场、字体设置 |
| **工作流** | 节点拖拽编排、连线、参数配置、运行预览 |
| **后台** | 用户管理、系统统计、日志查看 |
| **设置** | 主题切换、字体大小、API Key管理、端配置 |

---

## 七、核心引擎设计

### 7.1 Agent 引擎（LangGraph ReAct）

```
用户输入 → [规划(可选)] → [RAG检索(可选)] → ReAct循环:
  ├── 思考(Think) → 行动(Act/工具调用) → 观察(Observe)
  └── 循环直到完成或达到 max_iterations
→ [反思检查(可选)] → 输出
```

- **思考深度**：1=简洁, 2=标准, 3=详细（控制 prompt 中的思维链引导）
- **思考可见性**：visible/hidden/folded（控制 SSE 是否推送 think 事件）
- **记忆强度**：0-5 级（控制注入多少长期记忆 + 是否触发压缩）

### 7.2 8种编排模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| SINGLE | 单Agent执行 | 简单任务 |
| PARALLEL | 多Agent并行 | 独立子任务 |
| PIPELINE | 流水线串行 | 有依赖的步骤 |
| COLLABORATIVE | 协作(共享黑板) | 复杂问题 |
| DEBATE | 辩论+投票 | 需要多角度 |
| PEER_REVIEW | 同行评审 | 质量保证 |
| ROUND_TABLE | 圆桌共识 | 需要共识 |
| HIERARCHICAL | 层级委派 | 大型任务分解 |

### 7.3 记忆系统（多层防幻觉）

```
层1: 短期记忆 (ShortTerm)
  ├── 滑动窗口保留最近N条
  └── 自动摘要压缩旧消息

层2: 长期记忆 (LongTerm)  
  ├── ChromaDB 向量存储
  ├── 关键词索引（精确匹配加速）
  └── 按强度召回 top-K

层3: VCS 记忆版本控制
  ├── commit: 快照当前记忆状态
  ├── checkout: 回退到历史版本
  ├── diff: 对比两个版本差异
  └── 分支: 实验性记忆分支

层4: 记忆图谱 (MemoryGraph)
  ├── 节点=实体/概念
  ├── 边=关系
  └── 关键词索引加速检索

层5: 压缩器 (Compressor)
  ├── 高无损压缩（摘要+关键词提取+结构化）
  └── 按记忆强度自动触发
```

---

## 八、重构里程碑

### M0：基础设施搭建（第1阶段）
- [ ] 初始化新目录结构
- [ ] 后端：FastAPI 骨架 + 配置 + 数据库引擎(MySQL/SQLite切换)
- [ ] 后端：ORM 模型 + Alembic 迁移
- [ ] 前端：Vite + React + Tailwind + shadcn/ui 骨架
- [ ] 前端：路由 + 布局 + API 客户端
- [ ] Git 初始化 + CI 配置

### M1：认证系统
- [ ] 后端：注册/登录/验证码/JWT
- [ ] 后端：邮箱验证码服务
- [ ] 前端：登录/注册页（固定框+验证码+校验）
- [ ] 测试：认证全流程

### M2：对话核心
- [ ] 后端：Agent 引擎 + LLM 管理
- [ ] 后端：SSE 流式对话端点
- [ ] 前端：对话页（流式+思考+回溯+指令补全）
- [ ] 测试：对话全流程

### M3：Agent + 任务
- [ ] 后端：Agent CRUD + 快速/详细配置
- [ ] 后端：任务管理 + 8种编排 + 暂停恢复
- [ ] 前端：Agent管理页 + 任务管理页
- [ ] 测试：Agent/任务全流程

### M4：记忆 + RAG
- [ ] 后端：多层记忆系统 + VCS + 图谱 + 压缩
- [ ] 后端：RAG 知识库
- [ ] 前端：记忆查看页 + 知识库页
- [ ] 测试：记忆/RAG 全流程

### M5：技能市场 + IDE + 数据集
- [ ] 后端：技能管理 + GitHub 检索
- [ ] 后端：IDE 代码执行 + 插件
- [ ] 后端：数据集管理
- [ ] 前端：技能市场 + IDE + 数据集页
- [ ] 测试：全流程

### M6：多端
- [ ] CLI 端（Rich + Typer）
- [ ] 桌面端（Electron 打包）
- [ ] 后台管理页
- [ ] 设置页（主题/字体/端配置）
- [ ] 三端联调

### M7：部署 + 收尾
- [ ] Nginx 配置
- [ ] systemd 服务
- [ ] Dockerfile
- [ ] 文档完善
- [ ] 全量测试

---

## 九、开发规范

### 9.1 Git 规范
- **每次改动前先提交**（方便回退）
- commit message 格式：`type(scope): description`
  - `feat(auth): 实现邮箱验证码注册`
  - `fix(chat): 修复SSE断连`
  - `refactor(memory): 重构VCS记忆层`
  - `test(api): 补充认证接口测试`
  - `docs: 更新API文档`

### 9.2 测试规范
- 每个 API 端点必须有集成测试
- 核心引擎必须有单元测试
- 测试使用 SQLite 内存数据库（快速、隔离）
- 覆盖率目标：核心逻辑 > 80%

### 9.3 代码质量
- 后端：ruff lint + mypy 类型检查
- 前端：eslint + prettier
- PR 前必须通过 CI

### 9.4 API 版本
- 所有 API 前缀 `/api/v1/`
- 响应统一格式：`{ "ok": bool, "data": ..., "error": ... }`

---

## 十、与旧代码的关系

旧代码（`ai_hubs/src/`）中以下部分**有价值、可参考但不直接复用**：
- `core/orchestrator.py` — 8种编排模式的算法逻辑
- `core/communication.py` — 辩论/评审/圆桌/层级 实现
- `memory/enhanced_memory.py` — VCS记忆的 commit/checkout/diff 逻辑
- `skills/github_scanner.py` — GitHub 技能检索的 API 调用方式

其余（UI层、认证、数据库、前端）全部重写。

> 旧代码保留在 `ai_hubs/src/` 不动，新代码写入 `ai_hubs/backend/`，避免互相污染。待新代码完全替代后删除旧代码。
