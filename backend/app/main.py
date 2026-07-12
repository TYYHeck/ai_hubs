# -*- coding: utf-8 -*-
"""
AI Hubs v4.0 — FastAPI 应用入口

启动:
    cd backend
    python -m app.main              # 默认 127.0.0.1:8080
    python -m app.main --port 9090  # 自定义端口
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# 确保 backend/ 在 sys.path 中
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings, PROJECT_ROOT
from .database import init_database, close_database, get_db_type, is_db_available
from .api.v1 import api_router
from .services.auth_service import ensure_default_admin
from .services.builtin_skills import ensure_builtin_skills
from .database import get_session

logger = logging.getLogger("ai_hubs")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)


# ============================================================
# 生命周期
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期"""
    # ── 启动 ──
    logger.info("AI Hubs v4.0 启动中...")
    await init_database()
    logger.info(f"数据库就绪: {get_db_type()}")

    # 创建默认管理员
    async for session in get_session():
        await ensure_default_admin(session)

    # 初始化内置技能（docx / xlsx / pdf / ppt / web-search）
    async for session in get_session():
        await ensure_builtin_skills(session)

    logger.info("AI Hubs v4.0 启动完成")
    yield
    # ── 关闭 ──
    await close_database()
    logger.info("AI Hubs v4.0 已关闭")


# ============================================================
# 应用
# ============================================================

app = FastAPI(
    title="AI Hubs",
    description="新一代智能 Agent 平台",
    version="4.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由
app.include_router(api_router, prefix="/api/v1")


# ============================================================
# 前端静态托管（优先根目录 dist，兼容 frontend/dist）
# ============================================================

_ROOT_DIST = PROJECT_ROOT / "dist"
_FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
_DIST_DIR = _ROOT_DIST if _ROOT_DIST.is_dir() else _FRONTEND_DIST


@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "version": "4.0.0",
        "database": get_db_type(),
        "db_available": is_db_available(),
    }


@app.get("/", response_class=HTMLResponse)
async def index():
    """根路由：优先返回前端 SPA，未构建返回简单欢迎页"""
    index_html = _DIST_DIR / "index.html"
    if index_html.exists():
        return FileResponse(index_html)
    return HTMLResponse(_WELCOME_PAGE)


# 前端静态资源（assets 目录）
if (_DIST_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST_DIR / "assets"), name="assets")


# SPA 兜底
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """未知的非 API 路径返回 index.html（SPA 路由）"""
    index_html = _DIST_DIR / "index.html"
    if not index_html.exists():
        return HTMLResponse(_WELCOME_PAGE, status_code=404)
    # 放行 API 路径
    if full_path.startswith(("api/", "health", "metrics", "ws")) or "." in full_path:
        return HTMLResponse('{"detail":"Not Found"}', status_code=404,
                            media_type="application/json")
    return FileResponse(index_html)


# ============================================================
# 欢迎页（前端未构建时显示）
# ============================================================

_WELCOME_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Hubs v4.0</title>
<style>
body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e5e5e5;
       display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.card { text-align: center; padding: 48px; }
h1 { color: #3b82f6; font-size: 28px; margin-bottom: 8px; }
p { color: #999; line-height: 1.8; }
code { background: #1a1a1a; padding: 2px 8px; border-radius: 4px; color: #3b82f6; }
</style>
</head>
<body>
<div class="card">
<h1>AI Hubs v4.0</h1>
<p>后端已启动。前端尚未构建。</p>
<p>API 文档: <code>/docs</code></p>
<p>健康检查: <code>/health</code></p>
<p>构建前端: <code>cd frontend && npm run build</code></p>
</div>
</body>
</html>"""


# ============================================================
# 入口
# ============================================================

if __name__ == "__main__":
    import uvicorn

    # 解析命令行参数
    port = settings.server.port
    host = settings.server.host
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])
    if "--host" in sys.argv:
        idx = sys.argv.index("--host")
        if idx + 1 < len(sys.argv):
            host = sys.argv[idx + 1]

    print(f"\n  {'='*50}")
    print(f"  AI Hubs v4.0")
    print(f"  地址: http://{host}:{port}")
    print(f"  API文档: http://{host}:{port}/docs")
    print(f"  {'='*50}\n")

    uvicorn.run(app, host=host, port=port, log_level="info")
