# AI Hubs（AI 集群）v4.0 — 新一代智能 Agent 平台

> 基于 LangGraph ReAct 架构的多端智能 Agent 平台。支持 **8 种多 Agent 编排模式**、**技能市场**、**多层记忆保障防幻觉（Git 式 VCS / 记忆图谱 / 高无损压缩）**、**多端支持（Web / CLI / Electron 桌面端 / 后台管理）**。

- 后端：Python 3.11+ / FastAPI（`backend/app`）
- 前端：React 18 + TypeScript + Vite 5（`frontend`）
- CLI：Python（`cli/`，零外部 HTTP 依赖）
- 桌面端：Electron 28（`electron/`）
- 推理：LangChain + LangGraph；向量库 ChromaDB；持久化 MySQL 8.0（可回退 SQLite）

> ⚠️ 本文档对应 **v4 架构**。旧版根目录 `main.py`（导入 `src.ui.web_server`）已废弃，请勿使用 `python main.py` 系列命令，它们会导致 API 全部 405。

---

## 📁 目录结构（v4）

```
ai_hubs/
├── backend/
│   ├── app/                 # FastAPI v4 后端（活跃代码）
│   │   ├── main.py          # 入口：python -m app.main（uvicorn，默认 8080）
│   │   ├── api/v1/          # 路由：auth/chat/agents/tasks/memory/skills/datasets/ide/admin/...
│   │   ├── models/          # SQLAlchemy ORM 模型
│   │   ├── core/            # 核心引擎：agent/llm/orchestrator/task_manager
│   │   ├── services/        # 业务服务（认证、邮件等）
│   │   ├── security.py      # 原生 bcrypt 密码哈希
│   │   └── config.py        # 配置（backend/config.yaml + AIHUBS_ 环境变量）
│   ├── config.yaml          # 后端配置（MySQL/SQLite、JWT 等）
│   ├── pyproject.toml       # 后端依赖
│   └── requirements.txt
├── frontend/                # React + Vite 网页端
├── cli/                     # 命令行客户端（python -m cli）
├── electron/                # Electron 桌面端（自动拉起后端）
├── data/                    # 运行时数据（SQLite、IDE 工作区、llm_config.json）
├── src/                     # ⚠️ 旧 v3 代码，已废弃，仅供迁移参考
├── docs/                    # 文档（技术文档.md / USAGE.md / REBUILD_BLUEPRINT.md）
└── deploy/                  # systemd 服务文件 + nginx 配置
```

---

## 🚀 快速开始（本地开发）

### 前置要求
- Python 3.11+，建议使用虚拟环境 `python -m venv venv && source venv/bin/activate`
- Node.js 18+

### 1. 安装依赖
```bash
# 后端
cd backend
pip install -r requirements.txt

# 前端
cd ../frontend && npm install
```

### 2. 启动后端（中枢，其他端都依赖它）
```bash
cd backend
python -m app.main                        # 默认 127.0.0.1:8080
python -m app.main --host 0.0.0.0 --port 8080
```
- 数据库：读 `backend/config.yaml`。`force_sqlite: false` 且 `mysql.password` 非空 → 用 MySQL；否则回退 SQLite（`data/ai_hubs.db`）。
- 首次启动自动建表，并 seed 默认管理员 `admin / admin123`（仅在账户不存在时创建）。

### 3. 启动前端（Web）
```bash
cd frontend
npm run dev        # Vite → http://localhost:5173
```
Vite 已配置代理：`/api`、`/ws` → `127.0.0.1:8080`，因此 dev 模式直接连本地后端即可。

### 4. 启动 CLI 端
```bash
cd ai_hubs          # 仓库根，使 cli 包可导入（需在 venv 中）
python -m cli                 # 交互 REPL
python -m cli chat "你好"     # 一行模式
python -m cli login <用户> <密码>
python -m cli agents / skills / datasets / me
```
- 后端需已在 8080 运行（CLI 是 thin client，调 `/api/v1`）。
- 环境变量 `AIHUBS_BASE_URL` 可改后端地址（默认 `http://localhost:8080`）。

### 5. 启动 Electron 桌面端
```bash
cd frontend && npm run build    # 先构建 SPA
cd ../electron && npm install    # 首次安装 Electron
npm start                        # 自动拉起 v4 后端 + 打开窗口
```
`electron/main.js` 会 `spawn python backend/app/main.py --host 127.0.0.1 --port 8080`，再加载 `frontend/dist`。注意 Electron 用系统 `python` 命令拉后端，需系统 Python 已装后端依赖。

### 6. 后台管理
非独立端，是前端功能。用管理员账号登录网页端后，侧边栏「管理」分组出现「后台管理」入口（API `/api/v1/admin/dashboard`），可查看系统概览与用户管理。

---

## 🔑 LLM 配置（关键）

v4 **不读取** `.env` 里的 `DEEPSEEK_API_KEY` 等环境变量，而是从 **`data/llm_config.json`**（位于项目根目录 `ai_hubs/data/`）读取 key。配置方式有两种：

**方式一：直接写 `data/llm_config.json`（服务器采用，推荐）**
```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "api_key": "sk-你的真实key",
  "base_url": "https://api.deepseek.com/v1",
  "temperature": 0.7,
  "max_tokens": 4096
}
```
支持 provider：`openai` / `deepseek` / `zhipu` / `ollama` / `custom`（base_url 见 `backend/app/core/llm.py` 的 `PROVIDERS` 预设）。

**方式二：前端设置页**
登录后在「设置 → 模型 / LLM 配置」填入 Key 并保存，会自动写入同一 `llm_config.json`。

> 该文件每次对话都会重新读取，**修改后无需重启服务**即可生效。

---

## 🔐 认证
- JWT 认证（`python-jose`），密码使用**原生 bcrypt** 哈希（见 `backend/app/security.py`）。
- 默认管理员：`admin / admin123`。**建议登录后立即修改密码**。
- 支持邮箱 + 验证码注册（QQ 邮箱 SMTP，发送者 `3526145827@qq.com`）。

---

## 🖥 部署到 ECS（阿里云 8.138.24.27）

### 架构
```
浏览器 ──80/8001──▶ Nginx（8.138.24.27）
                       ├── /            → 静态托管 frontend/dist（/var/www/ai_hubs/dist）
                       └── /api /ws /health → 反代 127.0.0.1:8080（FastAPI）
                                        ▲
                          systemd 服务 ai_hubs（backend/app/main.py，端口 8080）
                            ├── MySQL 8.0（库 ai_hubs，用户 ai_hubs@localhost）
                            └── 运行时数据 data/（SQLite 备用 / llm_config.json / ChromaDB）
```

### 后端更新
```bash
# 本地（Windows）
cd ai_hubs && git push origin main

# 服务器
ssh root@8.138.24.27 "cd /root/ai_hubs && git pull && systemctl restart ai_hubs"
```
systemd 服务要点（`deploy/ai_hubs.service`）：
- `WorkingDirectory=/root/ai_hubs/backend`
- `ExecStart=/root/ai_hubs/venv/bin/python -m app.main --host 0.0.0.0 --port 8080`
- `EnvironmentFile=/root/ai_hubs/.env`

### 前端更新（本地构建后上传）
```powershell
# 本地（服务器内存小，npm build 在本地完成）
cd frontend; npm install; npm run build
scp -r -o ConnectTimeout=15 "frontend\dist\*" root@8.138.24.27:/var/www/ai_hubs/dist/
ssh root@8.138.24.27 "systemctl reload nginx"
```

### 服务器本地配置（不进 git）
- `backend/config.yaml`：`force_sqlite: false` + `mysql.password: AiHubs@2024!`（否则回退 SQLite）。
- `data/llm_config.json`：写入真实 LLM Key（见上「LLM 配置」）。
- `.env`：含 `DEEPSEEK_API_KEY` 等（经 EnvironmentFile 注入；当前 v4 主要用 `llm_config.json`，`.env` 作为兼容保留）。

### 数据库迁移（一次性，v3→v4 schema）
v4 的 `users` 需 `preferences` 列，`tasks` 需 `mode/think_depth/think_visibility/user_id` 列（含 `user_id` 外键 → `users.id`）。`create_all` 不会修改已存在表，需用 `ALTER TABLE` 补齐，并把旧行 `user_id` 回填管理员 `id=1`。详见 `docs/技术文档.md` 第 10 章。

---

## ⚠️ 已知坑位（部署必读）
1. **废弃入口**：根目录 `main.py`（v3）仍在仓库，但 systemd 必须指向 `backend/app/main.py`，否则 API 全部 405。
2. **LLM Key 位置**：必须写 `data/llm_config.json`，不是 `.env` 的 `DEEPSEEK_API_KEY` 环境变量。
3. **bcrypt 版本**：v4 用原生 `bcrypt`（`security.py`），不要装 `passlib`（passlib 1.7.4 与 bcrypt≥4.1 不兼容，会导致登录 401）。依赖已固定 `bcrypt>=4.0.1`。
4. **静态目录权限**：前端 dist 必须放 `/var/www/ai_hubs/dist`，不能放 `/root/ai_hubs/frontend/dist`（`/root` 权限 700，Nginx 的 www-data 读不到会 500）。
5. **Nginx try_files**：根路径用 `try_files $uri /index.html;`（不要加 `$uri/`），否则死循环 500。

---

## 📚 文档
- `docs/技术文档.md`：系统架构、配置、API、部署运维手册（含踩坑与排查）。
- `docs/USAGE.md`：各端使用与端到端测试指南。
- `docs/REBUILD_BLUEPRINT.md`：v4 完整重构蓝图（设计愿景）。

## ✅ 健康检查
```bash
curl -s http://localhost:8080/health   # {"status":"ok","database":"mysql","db_available":true}
curl -s -o /dev/null -w '%{http_code}' http://localhost/   # 200（Nginx 入口）
```
