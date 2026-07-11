# AI Hubs（AI 集群）v4.0 — 多端智能 Agent 平台

> 基于 **LangGraph ReAct** 架构的全栈多端 AI Agent 平台。支持 **8 种多 Agent 编排模式**、**技能市场**、**多层记忆防幻觉**、**内置 IDE 工作区**、**桌面客户端 WebSocket 本地代理**，覆盖 Web / CLI / Electron 三端。

[![Python](https://img.shields.io/badge/Python-3.11+-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18.3-61dafb)](https://react.dev)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-orange)](https://langchain-ai.github.io/langgraph)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-blue)](https://mysql.com)

---

## ✨ 核心特性

| 模块 | 特性 |
|------|------|
| **多 Agent 编排** | 8 种模式：Single / Sequential / Parallel / Debate / Vote / Hierarchical / Swarm / Auto |
| **LLM 多 Provider** | OpenAI / DeepSeek / ZhipuAI / Ollama / 自定义 Base URL，热重载无需重启 |
| **多层记忆** | 滑动窗口短期记忆 + ChromaDB 向量长期记忆 + Git 式 VCS 回滚 |
| **RAG 知识库** | 文档加载 → 语义分块 → ChromaDB 向量检索 |
| **内置 IDE** | 远程代码工作区（读写/运行/上传/预览/下载），隔离沙箱 500MB 配额 |
| **合并视图** | 文件树 + 编辑器 + 对话 三栏布局（`/workspace`） |
| **桌面本地代理** | Electron 客户端通过 WebSocket 把 AI 工具调用转发到本地执行 |
| **技能市场** | 内置 docx/xlsx/pdf/ppt/web-search 技能，支持 GitHub 安装自定义技能 |
| **任务系统** | 后台异步任务，含产出文件追踪、SSE 实时推送、思考深度/可见性控制 |
| **企业功能** | JWT + bcrypt 认证、邮箱验证码注册、Prometheus 监控、MySQL + Alembic 迁移 |

---

## 📁 目录结构

```
ai_hubs/
├── backend/
│   ├── app/
│   │   ├── main.py              # 入口：python -m app.main（Uvicorn ASGI）
│   │   ├── api/v1/              # REST + WebSocket 路由
│   │   │   ├── chat.py          # SSE 流式对话（含技能/工具调用/内部 API）
│   │   │   ├── agents.py        # Agent CRUD + AI 推荐配置
│   │   │   ├── tasks.py         # 任务管理（8 种编排模式）
│   │   │   ├── ide.py           # IDE 工作区（文件/运行/上传/预览/下载）
│   │   │   ├── ws.py            # WebSocket 本地工具代理端点
│   │   │   ├── memory.py        # 记忆管理（VCS 式提交/回滚/召回）
│   │   │   ├── skills.py        # 技能安装/卸载/GitHub 市场
│   │   │   ├── auth.py          # JWT 认证 + 邮箱注册
│   │   │   └── admin.py         # 后台管理（用户/系统概览）
│   │   └── core/
│   │       ├── llm.py           # LLM 多 Provider 抽象（stream_with_tools）
│   │       ├── orchestrator.py  # 多 Agent 编排引擎（8 种 LangGraph 模式）
│   │       ├── sandbox.py       # 代码沙箱（Python/JS/Bash/C/C++/Java，隔离执行）
│   │       ├── memory.py        # 多层记忆引擎（短期/长期/VCS）
│   │       ├── rag.py           # RAG 管道（ChromaDB）
│   │       ├── tools.py         # Agent 工具集 + 执行沙箱（含本地代理路由）
│   │       ├── internal_tools.py# 平台内部 API 工具（call_internal_api）
│   │       └── local_proxy.py   # WebSocket 本地工具代理管理器
├── frontend/
│   ├── src/
│   │   ├── pages/               # 15 个页面（Chat/IDE/Tasks/Agents/Memory/...）
│   │   ├── components/          # FilePreviewModal、TaskDrawer、Sidebar 等
│   │   └── stores/              # Zustand store（chat/theme/auth/localProxy）
│   └── dist/                    # 构建产物（已提交，服务器直接使用）
├── cli/                         # CLI 客户端（python -m cli）
├── electron/                    # Electron 桌面端（自动拉起后端）
├── deploy/                      # systemd 服务 + Nginx 配置
└── data/                        # 运行时数据（llm_config.json / SQLite / ChromaDB）
```

---

## 🚀 快速开始

### 前置要求
- Python 3.11+，Node.js 18+

### 安装 & 启动

```bash
# 1. 后端
cd backend
pip install -r requirements.txt
python -m app.main                    # → http://localhost:8080

# 2. 前端（开发模式）
cd frontend && npm install
npm run dev                           # → http://localhost:5173（代理 → :8080）

# 3. CLI
python -m cli                         # 交互 REPL
python -m cli chat "你好"             # 单行模式

# 4. Electron 桌面端
cd frontend && npm run build
cd ../electron && npm install && npm start  # 自动拉起后端 + 打开窗口
```

---

## 🔑 LLM 配置

编辑 `data/llm_config.json`（每次对话重新读取，**修改后无需重启**）：

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "api_key": "sk-你的Key",
  "base_url": "https://api.deepseek.com/v1",
  "temperature": 0.7,
  "max_tokens": 4096
}
```

支持 Provider：`openai` / `deepseek` / `zhipu` / `ollama` / `custom`

也可在前端「设置 → LLM 配置」页面填写，会自动写入此文件。

---

## 🤖 多 Agent 编排模式

| 模式 | 说明 |
|------|------|
| `single` | 单 Agent 执行，含记忆上下文 + RAG + 工具调用 |
| `sequential` | Agent 串行，前一个输出作为下一个输入 |
| `parallel` | 多 Agent 同时执行，汇总结果 |
| `debate` | Agent 互相质疑 → 综合最优答案 |
| `vote` | 多数投票决策 |
| `hierarchical` | 主管 Agent 分解任务 → 委派工作 Agent → 汇总 |
| `swarm` | 自组织协作，共享上下文 |
| `auto` | 自动分析任务特征选择最优模式 |

---

## 🖥 内置 IDE 工作区

每个用户拥有隔离的远程沙箱工作区（500MB 配额）：
- **文件管理**：读/写/新建/删除/上传（multipart）/预览（图片/PDF/文本/音视频）/下载
- **代码执行**：支持 Python / JavaScript / Bash / C / C++ / Java，30 秒超时
- **合并视图**：`/workspace` 路由，文件树 + 编辑器 + 对话 三栏布局
- **AI 集成**：AI 工具调用生成的文件自动出现在工作区，执行后扫描新文件通知用户

---

## 🔌 桌面客户端本地代理（WebSocket）

Electron 客户端通过 WebSocket 实现 AI 工具调用的本地路由：

```
AI 发起工具调用
  → 后端检测 WebSocket 连接（/api/v1/ws/local-tools）
  → 发送 tool_request 给客户端
  → 客户端通过 desktopIde 桥接在本地执行
  → 结果返回后端 → 继续 AI 对话
```

支持的本地工具：`read_file` / `write_file` / `list_files` / `run_code` / `run_terminal`  
失败时自动 fallback 到服务端沙箱执行。

---

## 📦 技能市场

内置技能：`docx`（Word）/ `xlsx`（Excel）/ `pdf` / `ppt`（PPT）/ `web-search`  
AI 触发方式：`/docx 帮我写报告` / `/ppt 生成幻灯片` / `/search 搜索XXX`  
自定义技能：从 GitHub 安装（`POST /api/v1/skills/market/github/install`）

---

## 📊 部署（ECS 阿里云）

```
浏览器 ──80──▶ Nginx（8.138.24.27）
                 ├── /            → frontend/dist（静态）
                 └── /api /ws /health → 127.0.0.1:8080（FastAPI）
                                  ▲
                  systemd: ai_hubs（python -m app.main）
                    ├── MySQL 8.0（库 ai_hubs）
                    └── data/（llm_config.json / ChromaDB / IDE 工作区）
```

**部署流程：**
```bash
# 后端更新（服务器自动 pull）
git push origin main
ssh root@8.138.24.27 "cd /root/ai_hubs && bash deploy/deploy_backend.sh"

# 前端更新（本地构建，服务器内存不足以 npm build）
cd frontend && npm run build
git add -f frontend/dist && git commit -m "build: update dist" && git push
ssh root@8.138.24.27 "cd /root/ai_hubs && git pull && systemctl reload nginx"
```

---

## 🔐 认证 & 安全

- JWT（HS256，24h 过期）+ 原生 `bcrypt` 密码哈希
- 邮箱验证码注册（SMTP）
- 沙箱路径越界防护（`realpath` + `_resolve` 校验）
- AI 工具调用临时文件执行后自动清理

> ⚠️ 示例账户：`demo / demo1234`，**上线前务必修改密码**  
> ⚠️ `backend/config.yaml` 中的 JWT secret 请替换为随机字符串

---

## ✅ 健康检查

```bash
curl http://localhost:8080/health
# → {"status":"ok","database":"mysql","db_available":true,"version":"4.0"}
```

---

## 📚 文档

- `docs/技术文档.md` — 系统架构、API、部署运维手册
- `docs/USAGE.md` — 各端使用与端到端测试
- `docs/REBUILD_BLUEPRINT.md` — v4 重构蓝图

---

## ⚠️ 已知注意事项

1. **LLM Key**：写 `data/llm_config.json`，不是 `.env` 的环境变量
2. **bcrypt 版本**：依赖原生 `bcrypt>=4.0.1`，勿安装 `passlib`（与 bcrypt≥4.1 不兼容）
3. **前端 dist 位置**：Nginx 静态目录用 `frontend/dist`（已在 git 追踪），`/root` 下权限 700 导致 www-data 无法访问
4. **前端构建**：服务器内存（1-2GB）不足以运行 `npm run build`，请在本地构建后提交 `frontend/dist`
5. **废弃入口**：根目录 `main.py`（v3）已废弃，不要用 `python main.py`
