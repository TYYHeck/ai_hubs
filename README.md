# AI Hubs v3.0 — 新一代智能 Agent 平台

> 基于 LangGraph ReAct 架构的智能 Agent 平台。支持 **8 种多Agent编排模式**、**17 个内置工具**、**Git式记忆版本控制**、**技能市场**、**内置IDE**、**多端部署（Web/CLI/Electron桌面端）**。

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
- [技能市场](#-技能市场)
- [增强记忆系统](#-增强记忆系统)
- [API 接口](#-api-接口)
- [前端界面](#-前端界面)
- [多端部署](#-多端部署)
- [开发指南](#-开发指南)

---

## ✨ 功能亮点

### 🤖 多 Agent 编排 (8种模式)

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `single` | 单 Agent 执行 | 简单问答、单一操作 |
| `parallel` | 多 Agent 并行 + 汇总 | 多角度分析、对比研究 |
| `pipeline` | 串行流水线接力 | 多步骤任务、数据处理 |
| `collaborative` | 协作讨论互审 | 决策评估、方案评审 |
| `debate` ⭐ | 正反方辩论 + 投票裁决 | 技术选型、利弊分析 |
| `peer_review` ⭐ | 执行→评审→修改→确认 | 代码审查、质量保障 |
| `round_table` ⭐ | 圆桌会议 + 共识追踪 | 头脑风暴、团队决策 |
| `hierarchical` ⭐ | 专家→经理→总监层级 | 审批流程、重大决策 |

### 🔐 邮箱验证码注册

- QQ邮箱 SMTP 验证码发送（HTML格式邮件）
- 密码强度校验 + 确认密码
- 客户端预校验 + 60秒冷却倒计时
- JWT Token 认证（含 uid/role）

### 🎯 技能市场

- **8个内置技能**: Python开发、Web全栈、数据分析、文档写作、代码审查、DevOps、调研分析、UI设计
- **GitHub技能探索**: 搜索开源AI技能仓库，一键导入安装
- **自定义创建**: 定义提示词模板、分类、标签
- **完整CRUD**: 安装/卸载/删除/创建

### 🧠 增强记忆系统

- **Git式VCS**: commit/checkout/log/diff 记忆版本控制
- **记忆图谱索引**: 关键词提取、语义关联边、主题聚类
- **高无损LLM压缩**: 替代简单截断，信息损失<5%
- **双路检索**: 图谱关键词 + 向量语义检索

### 📁 内置IDE

- 多文件标签管理（新建/保存/关闭）
- 语法高亮（Python/JS/TS/HTML/CSS/JSON/MD/SQL/YAML）
- 行号 + 文件浏览器 + 底部状态栏
- Ctrl+S 下载保存

### 💬 对话即管理

- **斜杠命令**: /agent /task /clear /recall /code /skill /search /config
- **快捷操作面板**: 一键跳转Agent/任务/技能/IDE
- SSE 实时流式对话 + Markdown 渲染

### 📊 数据集管理

- CRUD + JSON/CSV/纯文本导入导出
- 文件上传 + 追加记录
- 分类系统：训练数据/测试数据/提示词模板/知识问答/自定义

### 🖥 多端支持

- **Web端**: React 18 + TypeScript + Vite
- **CLI端**: prompt_toolkit + Tab补全 + 历史回溯 + Rich渲染
- **桌面端**: Electron 桌面应用（Win/Mac/Linux）

---

## 🏗 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                   多端接入                                     │
│    Web SPA (React 18)  │  CLI (prompt_toolkit)  │  Electron  │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST API + SSE Streaming
┌─────────────────────▼───────────────────────────────────────┐
│                  FastAPI Web Server (12个路由模块)            │
│  auth │ chat │ tasks │ agents │ skills │ memory │ datasets   │
│  knowledge │ files │ system │ config │ models │ workflow     │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    核心引擎 (LangGraph)                        │
│  Agent (ReAct) │ Orchestrator (8模式) │ TaskManager (队列)    │
│  SkillManager │ EnhancedMemory (VCS+Graph+Compress)          │
│  ToolRegistry (17工具) │ LLM Engine (5种提供商)               │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    数据层                                      │
│  ChromaDB (记忆+RAG) │ MySQL (认证/任务/Agent) │ FileSystem    │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 | 
|------|------|
| 运行时 | Python 3.11+ / Node.js 18+ |
| 推理框架 | LangChain + LangGraph |
| LLM | OpenAI / DeepSeek / 智谱 / Qwen / Ollama |
| Web | FastAPI + Uvicorn |
| 前端 | React 18 + TypeScript + Vite 6 + Zustand 5 |
| 向量库 | ChromaDB |
| 数据库 | MySQL 8.0+ |
| 桌面端 | Electron 28 |

---

## 🚀 快速开始

### 前置要求

- Python 3.11+
- Node.js 18+
- （可选）MySQL 8.0+ / ChromaDB

### 1. 安装依赖

```bash
cd ai_hubs
pip install -r requirements.txt
cd frontend && npm install && cd ..
```

### 2. 配置 LLM

```bash
# 设置 API Key
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxx"

# 或编辑 config.yaml
# llm.provider: "deepseek"
# llm.model: "deepseek-chat"
```

### 3. 启动后端

```bash
python main.py --web
# FastAPI → http://127.0.0.1:8080
```

### 4. 启动前端

```bash
cd frontend && npm run dev
# Vite → http://localhost:5173
```

### 4a. 启动桌面端（Electron）

```bash
npm run electron:dev
```

---

## ⚙️ 配置说明

详见 `config.yaml`：

```yaml
llm:                    # LLM提供商和模型配置
memory:                 # 短期记忆(轮数/阈值) + 长期记忆(ChromaDB)
agent:                  # Agent名称/系统提示词/迭代次数
tools:                  # 工具启用列表 + 危险工具 + 输出目录
orchestrator:           # 编排器：模式/并行数/辩论轮数等
auth:                   # JWT认证配置
database:               # MySQL连接配置
rag:                    # RAG知识库配置
```

---

## 🎯 技能市场

### 内置技能（8个）

| ID | 名称 | 分类 |
|----|------|------|
| python_dev | Python 开发 | 编程 |
| web_dev | Web 全栈开发 | 编程 |
| data_analysis | 数据分析 | 数据 |
| writing_assistant | 文档写作助手 | 写作 |
| code_reviewer | 代码审查员 | 编程 |
| devops_helper | DevOps 运维 | 运维 |
| research_analyst | 调研分析 | 调研 |
| ui_designer | UI 设计顾问 | 设计 |

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills/list` | 技能列表（支持分类/安装状态过滤） |
| POST | `/api/skills/{id}/install` | 安装技能 |
| POST | `/api/skills/{id}/uninstall` | 卸载技能 |
| GET | `/api/skills/github/search` | GitHub搜索 |
| POST | `/api/skills/create` | 创建自定义技能 |

---

## 🧠 增强记忆系统

### Git式版本控制

```
对话过程自动 commit → 可回退到任意版本
/vcs log     → 查看提交历史
/vcs commit  → 手动创建快照
/vcs checkout <id> → 回退到指定版本
/vcs diff <id1> <id2> → 版本对比
```

### 记忆图谱

- 自动提取关键词，建立语义关联边
- 主题聚类：发现记忆中的核心主题
- BFS图谱查询：找到关联的记忆链

### LLM压缩

- `/compress` → 调用LLM智能压缩对话历史
- 保留：主题/事实/决策/上下文依赖
- 压缩率5-10x，信息损失<5%

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/memory/vcs/log` | 版本历史 |
| POST | `/api/memory/vcs/commit` | 创建快照 |
| POST | `/api/memory/vcs/checkout` | 回退版本 |
| GET | `/api/memory/graph/visualize` | 图谱数据 |
| POST | `/api/memory/recall` | 双路检索 |
| POST | `/api/memory/compress` | LLM压缩 |

---

## 📡 API 接口

### 完整路由表（12个模块）

| 模块 | 前缀 | 说明 |
|------|------|------|
| auth | `/api/auth` | 登录/注册(验证码)/用户信息 |
| chat | `/api/chat` | SSE流式对话 |
| tasks | `/api/tasks` | 任务编排+队列管理 |
| agents | `/api/agents` | Agent CRUD |
| skills | `/api/skills` | 技能市场 |
| memory | `/api/memory` | 记忆系统(VCS+图谱+压缩) |
| datasets | `/api/datasets` | 数据集管理 |
| knowledge | `/api/knowledge` | RAG知识库 |
| files | `/api/files` | 文件管理 |
| system | `/api/system` | 系统信息+监控 |
| config | `/api/config` | 配置管理 |
| models | `/api/models` | 模型管理 |

---

## 🎨 前端界面

```
┌───────────┬──────────────────────────────────────────┐
│  Sidebar  │              Main Content                 │
│           │                                           │
│ 📊 仪表盘 │  Dashboard / Chat / Tasks / Agents        │
│ 💬 对话   │  Skills / Memory / IDE / Workflow         │
│ 📋 任务   │  Knowledge / Settings                     │
│ 🤖 Agent  │                                           │
│ 🎯 技能   │  暗色主题 · 实时SSE · 15秒自动刷新        │
│ 🧠 记忆   │  Zustand 状态管理 · 9个功能模块            │
│ 📁 IDE    │                                           │
│ 🔀 工作流 │                                           │
│ 📚 知识库 │                                           │
│ ⚙️ 设置   │                                           │
└───────────┴──────────────────────────────────────────┘
```

---

## 🖥 多端部署

### Web端

```bash
cd frontend && npm run build
# 静态文件部署到 Nginx / CDN
```

### CLI端

```bash
python main.py
# 交互式命令行，支持 Tab 补全、命令历史
# 输入 /help 查看所有命令
```

### 桌面端（Electron）

```bash
npm run electron:dev        # 开发模式
npm run electron:build      # 打包 (Win/Mac/Linux)
```

Electron 特性：
- 自定义应用菜单
- 后端进程生命周期管理
- 系统通知 + 文件对话框
- 窗口控制（最小化/最大化/关闭）

---

## 💻 开发指南

### 项目结构

```
ai_hubs/
├── main.py                    # 入口 (CLI + Web)
├── config.yaml                # 配置文件
├── requirements.txt           # Python 依赖
├── package.json               # Electron 桌面端配置
├── electron/
│   ├── main.js                # Electron 主进程
│   └── preload.js             # 预加载脚本
├── src/
│   ├── core/                  # 核心引擎
│   │   ├── agent.py           # ReAct Agent (LangGraph)
│   │   ├── llm.py             # LLM 引擎
│   │   ├── orchestrator.py    # 多Agent编排器(8模式)
│   │   ├── communication.py   # 高级通信模式
│   │   ├── task_manager.py    # 任务队列
│   │   └── config.py          # 配置管理
│   ├── tools/                 # 工具生态(17个)
│   ├── memory/                # 记忆系统
│   │   ├── memory_manager.py  # 短期+长期记忆
│   │   └── enhanced_memory.py # VCS+图谱+LLM压缩
│   ├── skills/                # 技能市场
│   │   ├── skill_manager.py   # 技能CRUD+内置技能
│   │   └── github_scanner.py  # GitHub搜索
│   ├── datasets/              # 数据集管理
│   ├── rag/                   # RAG知识库
│   ├── auth/                  # JWT认证
│   └── ui/                    # 界面层
│       ├── web_server.py      # FastAPI主服务
│       ├── cli.py             # CLI交互界面
│       └── routers/           # 12个路由模块
├── frontend/
│   └── src/
│       ├── App.tsx            # 主框架(9个Tab)
│       ├── index.css          # 暗色主题
│       ├── stores/            # Zustand状态管理
│       ├── api/               # API客户端
│       ├── types/             # TypeScript类型
│       └── components/        # 9个核心组件
└── data/                      # 数据目录
```

### 添加自定义技能

```python
# POST /api/skills/create
{
  "id": "my_skill",
  "name": "我的技能",
  "category": "coding",
  "prompt_template": "你是一个...",
  "tags": ["标签1", "标签2"]
}
```

### 添加自定义工具

```python
from src.tools.base import tool

@tool(description="工具描述", dangerous=False)
def my_tool(param: str) -> str:
    """实现"""
    return result

# 注册到 config.yaml tools.enabled 列表
```

### 后端验证

```bash
python -c "import py_compile; py_compile.compile('src/core/agent.py', doraise=True)"
```

### 前端验证

```bash
cd frontend && npx tsc --noEmit
```

---

## 📊 版本历史

### v3.0.0 (当前)

- 🆕 **品牌重塑**: SmartAgent → AI Hubs
- 🆕 **邮箱验证码注册**: QQ SMTP + 验证码校验 + 密码强度
- 🆕 **技能市场**: 8内置技能 + GitHub探索 + 自定义创建
- 🆕 **Git式记忆VCS**: commit/checkout/log/diff
- 🆕 **记忆图谱索引**: 关键词关联 + 主题聚类
- 🆕 **LLM高无损压缩**: 替代简单截断
- 🆕 **内置IDE**: 多文件编辑 + 语法高亮
- 🆕 **对话即管理**: 斜杠命令 + 快捷操作
- 🆕 **数据集管理**: JSON/CSV导入导出
- 🆕 **Electron桌面端**: Win/Mac/Linux
- 🆕 **CLI增强**: /vcs /graph /compress 命令

---

<p align="center">
  <strong>AI Hubs v3.0</strong> — 新一代智能 Agent 平台
</p>
