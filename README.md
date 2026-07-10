# SmartAgent v3.0 — 企业级多 Agent 智能编排平台

> 基于 LangGraph ReAct 架构的多 Agent 智能协作平台。支持 **8 种执行模式**、**17 个内置工具**、**SSE 流式响应**、**可视化工作流编排**、**JWT 认证**、**Prometheus 监控**。

<p align="center">
  <strong>Python</strong> 后端 · <strong>React 18</strong> 前端 · <strong>LangChain</strong> 推理 · <strong>ChromaDB</strong> 记忆 · <strong>MySQL</strong> 持久化
</p>

---

## 📋 目录

- [功能亮点](#-功能亮点)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
- [配置说明](#-配置说明)
- [执行模式](#-执行模式)
- [工具生态](#-工具生态)
- [API 接口](#-api-接口)
- [前端界面](#-前端界面)
- [部署指南](#-部署指南)
- [开发指南](#-开发指南)

---

## ✨ 功能亮点

### 🤖 多 Agent 编排 (8 种模式)

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `single` | 单 Agent 执行 | 简单问答、单一操作 |
| `parallel` | 多 Agent 并行 + 汇总 | 多角度分析、对比研究 |
| `pipeline` | 串行流水线接力 | 多步骤任务、数据处理 |
| `collaborative` | 协作讨论互审 | 决策评估、方案评审 |
| `debate` ⭐ | 正反方辩论 + 投票裁决 | 技术选型、利弊分析 |
| `peer_review` ⭐ | 执行→评审→修改→确认 | 代码审查、质量保障 |
| `round_table` ⭐ | 圆桌会议 + 共识追踪 | 头脑风暴、团队决策 |
| `hierarchical` ⭐ | 专家→经理→总监层级决策 | 审批流程、重大决策 |

⭐ = v3.0 新增

### 🛠 工具生态 (17 个工具)

**基础工具**: `web_search`, `fetch_url`, `read_file`, `write_file`, `run_python`, `calculator`, `generate_image`

**扩展工具** ⭐: `database_query` (SQLite/MySQL/PG), `http_api_call`, `run_shell`, `send_email`, `read_pdf`, `read_excel`, `json_process`, `time_tool`, `text_diff`, `image_analyze`

### 🎨 前端 SPA (React 18 + TypeScript)

- **仪表盘**: 8 张统计卡 + Agent 状态表 + 系统信息
- **对话**: SSE 流式渲染 + Markdown 渲染 (代码高亮/表格/引用)
- **任务编排**: SSE 进度日志 + 任务队列 + 详情面板
- **Agent 管理**: 卡片网格 + 创建/编辑弹窗 + 技能选择
- **工作流编辑** ⭐: Canvas 拖拽 DAG 画布 + 4 套内置模板
- **知识库**: 拖拽上传 + 语义搜索 + 文件管理
- **系统设置**: LLM 配置 + 模型切换 + 功能开关

### 🔐 企业特性

- **JWT 认证**: 完整的注册/登录/Token 刷新
- **速率限制**: 令牌桶算法，每 IP 限流
- **MySQL 持久化**: Agent/用户/任务/日志
- **Prometheus 监控**: `/metrics` 端点 + 请求计数
- **ChromaDB 记忆**: 短期会话 + 长期记忆 + RAG 知识库

---

## 🏗 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 SPA (React 18)                     │
│  Dashboard │ ChatView │ TaskManager │ AgentManager │      │
│  WorkflowEditor │ KnowledgeBase │ Settings              │
└─────────────────┬───────────────────────────────────────┘
                  │ REST API + SSE Streaming
┌─────────────────▼───────────────────────────────────────┐
│                FastAPI Web Server (127.0.0.1:8080)       │
│  /api/chat  │  /api/tasks  │  /api/agents  │  /api/kb   │
│  /api/auth  │  /api/config │  /health  │  /metrics      │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│                    核心引擎 (LangGraph)                    │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Agent   │  │ Orchestrator │  │  TaskManager      │  │
│  │ ReAct推理 │  │ 8种执行模式  │  │ 优先级队列        │  │
│  │ 工具调用  │  │ LLM工作流分配│  │ 智能Agent匹配     │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │Communication│ │  ToolRegistry│  │  LLM Engine      │  │
│  │ 辩论/评审   │ │ 17个内置工具 │  │ 5种提供商         │  │
│  │ 圆桌/层级   │ │ @tool装饰器  │  │ OpenAI/DS/Qwen... │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│                    数据层                                  │
│  ChromaDB (记忆)  │  MySQL (持久化)  │  FileSystem (输出)  │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Python | 3.11+ |
| 推理框架 | LangChain + LangGraph | latest |
| LLM 提供商 | OpenAI / DeepSeek / 智谱 / Qwen / Ollama | — |
| Web 框架 | FastAPI + Uvicorn | latest |
| 前端 | React 18 + TypeScript + Vite 6 | — |
| 状态管理 | Zustand 5 | — |
| 向量数据库 | ChromaDB | — |
| 关系数据库 | MySQL + PyMySQL | 8.0+ |
| 监控 | Prometheus | — |
| 认证 | JWT + bcrypt | — |

---

## 🚀 快速开始

### 前置要求

- Python 3.11+
- Node.js 18+
- （可选）MySQL 8.0+
- （可选）ChromaDB

### 1. 克隆项目

```bash
git clone <repo-url>
cd smart_agent
```

### 2. 安装后端依赖

```bash
pip install -r requirements.txt
```

### 3. 配置 LLM

编辑 `config.yaml` 或设置环境变量：

```bash
# 例如使用 DeepSeek
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxx"
```

```yaml
# config.yaml
llm:
  provider: "deepseek"
  model: "deepseek-chat"
  # api_key 留空自动从环境变量读取
```

### 4. 启动后端

```bash
python main.py --web
# FastAPI 服务启动在 http://127.0.0.1:8080
```

### 5. 启动前端（开发模式）

```bash
cd frontend
npm install
npm run dev
# Vite 开发服务器启动在 http://localhost:5173
```

### 6. 构建前端（生产模式）

```bash
cd frontend
npm run build
# 构建产物在 frontend/dist/
```

---

## ⚙️ 配置说明

详见 `config.yaml`，主要配置项：

### LLM 配置

```yaml
llm:
  provider: "deepseek"       # openai / deepseek / zhipu / qwen / ollama / custom
  model: "deepseek-chat"     # 模型名称
  temperature: 0.7           # 生成温度
  max_tokens: 4096
  timeout: 60
```

### 工具配置

```yaml
tools:
  enabled:                   # 启用列表，空列表=全部
    - "web_search"
    - "fetch_url"
    - "run_python"
    # ... 共 17 个可选工具
  dangerous:                 # 需用户确认的危险工具
    - "run_python"
    - "write_file"
    - "run_shell"
    - "database_query"
    - "http_api_call"
  output_dir: "./output"
```

### 编排器配置

```yaml
orchestrator:
  default_mode: "auto"       # 默认执行模式
  parallel:
    max_agents: 4
  debate:                    # v3.0 新增
    rounds: 2
  peer_review:               # v3.0 新增
    approval_threshold: 7.0
  round_table:               # v3.0 新增
    discussion_rounds: 2
```

### 认证配置

```yaml
auth:
  enabled: true
  jwt_secret_key: ""         # 生产环境务必设置！
  jwt_expire_minutes: 480
```

### 数据库配置

```yaml
database:
  host: "127.0.0.1"
  port: 3306
  user: "smart_agent"
  password: ""
  database: "smart_agent"
```

---

## 🎯 执行模式

### 自动模式检测 (AUTO)

系统自动分析任务描述中的关键词，选择最佳执行模式：

```python
# 简单问答 → SINGLE
"什么是 LangChain？"

# 多角度分析 → PARALLEL
"从技术、市场、成本三个维度对比分析云计算方案"

# 多步骤流程 → PIPELINE
"先调研最新的前端框架，然后对比优缺点，最后给出推荐方案"

# 决策评估 → COLLABORATIVE
"评估是否应该从 MySQL 迁移到 PostgreSQL"

# 辩论决策 → DEBATE (v3.0)
"辩论：微服务架构 vs 单体架构，哪个更适合创业团队"

# 质量审查 → PEER_REVIEW (v3.0)
"审查这段 Python 代码的安全性和性能问题"

# 头脑风暴 → ROUND_TABLE (v3.0)
"团队讨论：我们的产品下个季度的功能优先级"
```

### LLM 驱动的智能工作流分配

启用 `use_llm_allocation=True` 后，系统使用 LLM 分析任务并自动分配 Agent 角色和工作流，非硬编码关键词匹配。

---

## 🛠 工具生态

### 工具注册

```python
from src.tools.base import tool

@tool(description="执行 SQL 查询", dangerous=True)
def database_query(connection: str, query: str, limit: int = 20) -> str:
    ...
```

### 基础工具 (7 个)

| 工具 | 说明 |
|------|------|
| `web_search` | DuckDuckGo 互联网搜索 |
| `fetch_url` | HTTP 网页内容抓取 |
| `read_file` | 读取文本/.docx 文件 |
| `write_file` | 写入文件（自动关联任务） |
| `run_python` | 沙箱化 Python 执行 |
| `calculator` | 数学表达式计算 |
| `generate_image` | Matplotlib 图表生成 |

### 扩展工具 (10 个，v3.0 新增)

| 工具 | 说明 |
|------|------|
| `database_query` | SQL 查询（SQLite/MySQL/PostgreSQL） |
| `http_api_call` | HTTP API 调用（GET/POST/PUT/DELETE） |
| `run_shell` | 受限 Shell 命令执行 |
| `send_email` | SMTP 邮件发送 |
| `read_pdf` | PDF 文本提取（PyMuPDF/pdfplumber/PyPDF2） |
| `read_excel` | Excel/CSV 表格读取（table/json 格式） |
| `json_process` | JSON 数据查询与转换 |
| `time_tool` | 时间日期计算与格式化 |
| `text_diff` | 文本差异对比（unified diff） |
| `image_analyze` | 图片信息提取（OCR + EXIF） |

---

## 📡 API 接口

### 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat/stream` | SSE 流式对话 |

### 任务编排

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tasks/orchestrate` | SSE 编排执行任务 |
| `GET` | `/api/tasks` | 获取任务列表和队列状态 |
| `GET` | `/api/tasks/{id}` | 获取任务详情 |
| `GET` | `/api/tasks/modes` | 获取可用执行模式列表 |

### Agent 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/agents` | 获取 Agent 列表 |
| `POST` | `/api/agents` | 创建 Agent |
| `PUT` | `/api/agents/{name}` | 更新 Agent |
| `DELETE` | `/api/agents/{name}` | 删除 Agent |

### 知识库

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/kb/upload` | 上传文件 |
| `GET` | `/api/kb/files` | 文件列表 |
| `GET` | `/api/kb/search` | 语义搜索 |
| `DELETE` | `/api/kb/files/{filename}` | 删除文件 |
| `DELETE` | `/api/kb/clear` | 清空知识库 |

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/register` | 用户注册 |
| `POST` | `/api/auth/login` | 用户登录 |
| `POST` | `/api/auth/refresh` | 刷新 Token |

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config` | 获取当前配置 |
| `PUT` | `/api/config` | 更新配置 |
| `POST` | `/api/config/switch-model` | 切换 LLM 模型 |
| `GET` | `/health` | 健康检查 |
| `GET` | `/metrics` | Prometheus 指标 |

---

## 🎨 前端界面

### 界面概览

```
┌───────────┬──────────────────────────────────────────┐
│  Sidebar  │              Main Content                 │
│           │                                           │
│ 📊 仪表盘 │  ┌─────────────────────────────────────┐  │
│ 💬 对话   │  │  Dashboard / Chat / Tasks / ...     │  │
│ 📋 任务   │  │                                     │  │
│ 🤖 Agent  │  │  7 个功能页面，暗色主题设计          │  │
│ 🔀 工作流 │  │  SSE 实时更新，15秒自动刷新          │  │
│ 📚 知识库 │  │                                     │  │
│ ⚙️ 设置   │  └─────────────────────────────────────┘  │
│           │                                           │
│ 统计信息  │                                           │
└───────────┴──────────────────────────────────────────┘
```

### 开发模式启动

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

### 生产构建

```bash
npm run build     # 输出到 frontend/dist/
```

---

## 🚢 部署指南

### Docker 部署

```dockerfile
# Dockerfile (示例)
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["python", "main.py", "--web"]
```

```bash
docker build -t smart-agent .
docker run -p 8080:8080 \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -e JWT_SECRET_KEY=your-secret \
  -v ./data:/app/data \
  -v ./output:/app/output \
  smart-agent
```

### 生产环境检查清单

- [ ] 设置 `auth.jwt_secret_key` 为随机强密码
- [ ] 配置 MySQL 数据库连接
- [ ] 设置 LLM API Key 环境变量
- [ ] 配置 Nginx 反向代理 + SSL
- [ ] 设置日志级别为 INFO
- [ ] 启用速率限制
- [ ] 配置 Prometheus 抓取 `/metrics`
- [ ] 设置 `tools.output_dir` 为持久化存储路径

---

## 💻 开发指南

### 项目结构

```
smart_agent/
├── main.py                    # 入口 (CLI + Web)
├── config.yaml                # 配置文件
├── requirements.txt           # Python 依赖
├── src/
│   ├── core/
│   │   ├── agent.py           # Agent 核心 (LangGraph ReAct)
│   │   ├── llm.py             # LLM 引擎 (5 种提供商)
│   │   ├── orchestrator.py    # 多 Agent 编排器
│   │   ├── communication.py   # 高级通信模式 (v3.0)
│   │   ├── task_manager.py    # 任务队列管理
│   │   └── config.py          # 配置管理
│   ├── tools/
│   │   ├── base.py            # 工具注册系统 (@tool 装饰器)
│   │   ├── builtin_tools.py   # 7 个基础工具
│   │   └── extended_tools.py  # 10 个扩展工具 (v3.0)
│   ├── memory/
│   │   └── memory_manager.py  # 短期 + 长期记忆
│   ├── rag/
│   │   └── knowledge_base.py  # RAG 知识库
│   └── ui/
│       ├── web_server.py      # FastAPI 主服务器
│       └── routers/           # API 路由
│           ├── chat.py        # 对话 SSE
│           ├── tasks.py       # 任务编排
│           ├── agents.py      # Agent CRUD
│           ├── knowledge.py   # 知识库
│           └── system.py      # 系统管理
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx            # 主框架 (7 个 Tab)
│       ├── index.css          # 暗色主题 CSS 变量
│       ├── types/index.ts     # TypeScript 类型
│       ├── api/client.ts      # API 客户端 (SSE + REST)
│       ├── stores/appStore.ts # Zustand 全局状态
│       └── components/
│           ├── Sidebar.tsx         # 导航侧边栏
│           ├── Dashboard.tsx       # 仪表盘
│           ├── ChatView.tsx        # 对话界面
│           ├── TaskManager.tsx     # 任务管理
│           ├── AgentManager.tsx    # Agent 管理
│           ├── WorkflowEditor.tsx  # 工作流编辑器 (v3.0)
│           ├── KnowledgeBase.tsx   # 知识库
│           └── Settings.tsx        # 系统设置
├── data/                       # 数据目录
│   ├── memory.db               # ChromaDB 长期记忆
│   └── vectordb/               # RAG 向量库
├── output/                     # Agent 输出文件
└── logs/                       # 日志文件
```

### 添加自定义工具

```python
# 1. 在 src/tools/ 下创建新文件或在 extended_tools.py 中添加

from src.tools.base import tool

@tool(description="你的工具描述", dangerous=False)
def my_tool(param1: str, param2: int = 10) -> str:
    """工具实现"""
    return f"结果: {param1} x {param2}"

# 2. 注册工具
from src.tools.base import get_registry
registry = get_registry()
registry.register(my_tool)

# 3. 在 config.yaml 的 tools.enabled 列表中添加 "my_tool"
```

### 添加自定义执行模式

```python
# 在 src/core/orchestrator.py 的 ExecutionMode 枚举中添加
# 在 src/core/communication.py 中实现具体逻辑
# 在 Orchestrator 的 execute() 方法中添加分支
# 在 ModeDetector 的 MODE_KEYWORDS 中添加触发关键词
```

### 运行测试

```bash
# 工具系统测试
python -m src.tools.builtin_tools
python -m src.tools.extended_tools
python -m src.tools.base

# 前端类型检查
cd frontend && npx tsc --noEmit

# 前端构建
cd frontend && npm run build
```

---

## 📊 变更日志

### v3.0.0 (当前)

- 🆕 **10 个扩展工具**: database_query, http_api_call, run_shell, send_email, read_pdf, read_excel, json_process, time_tool, text_diff, image_analyze
- 🆕 **4 种高级协作模式**: debate (辩论), peer_review (同行评审), round_table (圆桌会议), hierarchical (层级决策)
- 🆕 **可视化工作流编辑器**: Canvas 拖拽 DAG 画布 + 4 套内置模板
- 🆕 **专业 React SPA 前端**: 7 个功能页面 + 暗色主题 + SSE 实时更新
- 🔧 编排器扩展支持 8 种执行模式
- 🔧 配置系统新增 debate/peer_review/round_table/hierarchical 参数

### v2.0.0

- LangGraph ReAct Agent 核心
- 4 种基础执行模式 (SINGLE/PARALLEL/PIPELINE/COLLABORATIVE)
- 7 个基础工具
- FastAPI Web 服务器 + JWT 认证
- MySQL 持久化 + Prometheus 监控
- ChromaDB 记忆系统 + RAG 知识库

---

## 📄 License

MIT License

---

<p align="center">
  <strong>SmartAgent v3.0</strong> — 让 AI Agent 协作更智能
</p>
