# AI Hubs 使用与部署指南（v4 架构）

> 本文档对应当前活跃代码：`backend/app`（FastAPI v4 后端）、`frontend`（React 18 网页端）、`cli`（命令行客户端）、`electron`（桌面端）。

## 1. 目录结构

```
ai_hubs/
├── backend/app/        # FastAPI v4 后端（API / 模型 / 服务）
│   ├── main.py         # 应用入口（uvicorn，端口 8080）
│   ├── api/v1/         # 各业务路由（auth/chat/agents/tasks/memory/skills/datasets/ide/admin）
│   ├── models/         # SQLAlchemy ORM 模型
│   ├── schemas/        # Pydantic Schema
│   └── services/       # 业务服务（认证、技能拉取等）
├── frontend/           # React 18 + Vite + TypeScript 网页端
├── cli/                # Python 命令行客户端（零依赖，连接 /api/v1）
├── electron/           # Electron 桌面端外壳
├── data/               # SQLite 数据库（force_sqlite 时）与 IDE 工作区
├── tests/              # smoke_m5.py / smoke_m6.py 端到端测试
└── docs/               # 文档
```

## 2. 后端运行

```bash
cd backend
pip install -r requirements.txt
python -m app.main                 # 默认 127.0.0.1:8080
python -m app.main --port 9090     # 自定义端口
```

- 数据库：读 `backend/config.yaml`，`mysql.password` 非空则用 MySQL，否则回退 SQLite（`data/ai_hubs.db`）。
  也可通过环境变量 `DB_URL` 强制指定（如 `sqlite+aiosqlite:///./data/test.db`）。
- 首次启动自动建表，并**仅在账户不存在时** seed 默认管理员 `admin / admin123`（可在 `backend/config.yaml` 的 `auth.default_admin_password` 修改）。
- 前端由后端在 `frontend/dist` 存在时一并托管（SPA），无需单独起前端服务即可访问网页端。

## 3. 前端运行与构建

```bash
cd frontend
npm install
npm run dev        # 开发模式（热更新）
npm run build      # 生产构建，产物在 frontend/dist
```

构建后的 `dist` 由后端托管，部署时将其复制到服务器对应目录即可（见第 7 节）。

## 4. CLI 命令行客户端

零外部依赖（仅用标准库 `urllib`），连接后端 `/api/v1`。

```bash
# 交互模式（推荐）：上下箭头回溯历史，Tab 列出可用指令
python -m cli

# 一行模式
python -m cli login <用户名> <密码>
python -m cli chat "你好"
python -m cli agents
python -m cli skills
python -m cli datasets
python -m cli me
```

交互模式指令：`:login` `:me` `:agents` `:skills` `:datasets` `:chat <内容>` `:clear` `:help` `:quit`。
直接输入文本也会作为对话发送。会话令牌保存在 `~/.aihubs/cli_session.json`，下次免登录。

环境变量：
- `AIHUBS_BASE_URL`：后端地址，默认 `http://localhost:8080`。

## 5. 桌面端（Electron）

```bash
cd frontend && npm install && npm run build   # 先构建前端
cd ../electron && npm install                  # 安装 Electron（首次）
npm start                                      # 启动，自动拉起后端并打开窗口
```

打包分发见 `electron/README.md`。

## 6. 后台管理

- 使用管理员账号（默认 `admin/admin123`）登录网页端。
- 侧边栏「管理」分组会出现「后台管理」入口（`/admin`）。
- 功能：系统概览仪表盘（用户/Agent/技能/数据集/任务/对话统计）、用户列表管理（搜索、分页、修改角色/启用状态/邮箱、删除）。

## 7. 测试

```bash
# M5 端点（技能/数据集/IDE）端到端测试
python tests/smoke_m5.py
# M6 端点（admin + CLI）端到端测试（会启动临时后端线程）
python tests/smoke_m6.py
```

两项测试均会拉起真实后端并覆盖核心接口，全部通过方可合并。

## 8. 部署到 ECS（阿里云，root@8.138.24.27）

1. **后端**：在服务器 `git pull`（私有库需提供凭证），然后 `systemctl restart ai_hubs`。
2. **前端**：本地构建后上传静态文件：
   ```powershell
   cd frontend; npm run build
   scp -r -o ConnectTimeout=15 "frontend\dist\*" root@8.138.24.27:/var/www/ai_hubs/dist/
   ```
   后端 `systemctl restart ai_hubs` 后由 Nginx 反代 `/api`、`/ws`、`/health`、`/metrics`。
3. **默认管理员**：`admin / admin123`（如需修改，在服务器 `config.yaml` 或环境变量 `ADMIN_PASSWORD` 设置）。
4. **LLM API Key**：v4 **不读取** `.env` 环境变量，必须写入 `data/llm_config.json`（位于项目根 `ai_hubs/data/`，含 `provider`/`model`/`api_key`/`base_url`）；也可在网页端「设置 → 模型 / LLM 配置」填入并保存。修改后**无需重启**服务即可生效。
