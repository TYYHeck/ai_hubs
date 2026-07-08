# SmartAgent - 智能 AI Agent 框架

基于 **LangChain ReAct** 架构的智能 AI Agent 框架，支持命令行和 Web 可视化两种交互方式。

## 架构

```
┌─────────────────────────────────────────────┐
│                  SmartAgent                  │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │   CLI    │  │  Web UI  │  │ Task Mgr  │ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
│       │              │              │       │
│  ┌────▼──────────────▼──────────────▼─────┐ │
│  │          Agent (LangChain ReAct)       │ │
│  │  ┌──────────┐  ┌────────────────────┐  │ │
│  │  │ ChatOpenAI│  │  StructuredTool   │  │ │
│  │  └──────────┘  └────────────────────┘  │ │
│  └────────────────────────────────────────┘ │
│       │              │              │       │
│  ┌────▼────┐  ┌──────▼──────┐  ┌───▼─────┐ │
│  │ Memory  │  │  Knowledge  │  │  Tools  │ │
│  │ (Chroma)│  │  Base (RAG) │  │  (6个)  │ │
│  └─────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────────────────────┘
```

## 核心特性

| 特性 | 说明 |
|------|------|
| **LangChain ReAct** | 基于 `create_react_agent` + `AgentExecutor` |
| **多模型支持** | OpenAI / DeepSeek / 通义千问 / 智谱GLM / Ollama |
| **工具系统** | 搜索、网页抓取、文件读写、Python执行、计算器 |
| **记忆系统** | 短期记忆（滑动窗口）+ 长期记忆（ChromaDB） |
| **RAG 知识库** | 文档加载 → 向量化 → 语义检索 |
| **任务管理** | 发布/分配/追踪/取消任务 |
| **Agent 管理** | 注册/注销/查看 Agent 状态 |
| **计划模式** | 复杂任务自动分解为子任务 |
| **反思模式** | 完成后自我检查答案质量 |

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 设置 API Key

```powershell
# PowerShell
$env:DEEPSEEK_API_KEY='sk-xxx'
# 或
$env:OPENAI_API_KEY='sk-xxx'
```

```bash
# Bash
export DEEPSEEK_API_KEY=sk-xxx
```

### 3. 运行

```bash
# 命令行模式
python main.py

# Web 可视化模式
python main.py --web

# 自定义端口
python main.py --web --port 9090
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/exit`, `/q` | 退出 |
| `/clear` | 清空对话 |
| `/debug` | 调试模式 |
| `/tools` | 列出工具 |
| `/stats` | 运行统计 |
| `/model [id]` | 查看/切换模型 |
| `/plan` | 切换计划模式 |
| `/rag` | 切换 RAG |
| `/reflect` | 切换反思模式 |
| `/recall <q>` | 搜索记忆 |
| `/task publish <描述>` | 发布任务 |
| `/task list [状态]` | 任务列表 |
| `/task queue` | 队列状态 |
| `/agent list` | Agent 列表 |
| `/agent register` | 注册 Agent |

## Web API

| 路由 | 说明 |
|------|------|
| `GET /` | 聊天页面 |
| `POST /api/chat` | 发送消息 (SSE) |
| `GET /api/config` | Agent 配置 |
| `POST /api/switch_model` | 切换模型 |
| `POST /api/toggle_mode` | 切换模式 |
| `POST /api/tasks/publish` | 发布任务 |
| `GET /api/tasks/list` | 任务列表 |
| `GET /api/agents/list` | Agent 列表 |
| `POST /api/agents/register` | 注册 Agent |

## 项目结构

```
smart_agent/
├── main.py                 # 入口
├── config.yaml             # 配置文件
├── requirements.txt        # 依赖
├── README.md
└── src/
    ├── core/
    │   ├── agent.py        # Agent 核心 (LangChain ReAct)
    │   ├── llm.py          # LLM 引擎 (OpenAI + LangChain)
    │   ├── message.py      # 消息系统
    │   ├── config.py       # 配置管理
    │   └── task_manager.py # 任务管理器
    ├── tools/
    │   ├── base.py         # 工具注册系统
    │   └── builtin_tools.py # 内置工具 (6个)
    ├── memory/
    │   └── memory_manager.py # 记忆系统
    ├── rag/
    │   └── knowledge_base.py # RAG 知识库
    └── ui/
        ├── cli.py          # 命令行界面
        └── web_server.py   # Web 界面
```

## 技术栈

- **Agent 框架**: LangChain (create_react_agent + AgentExecutor)
- **LLM 引擎**: OpenAI SDK + langchain-openai
- **工具系统**: LangChain StructuredTool
- **记忆系统**: ChromaDB + ConversationBufferWindowMemory
- **Web 框架**: FastAPI + SSE 流式推送
- **CLI**: Rich + prompt_toolkit
