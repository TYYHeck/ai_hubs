# -*- coding: utf-8 -*-
"""IDE 路由 —— 代码远程执行 + 扩展插件市场"""

from __future__ import annotations
import os
import json
import asyncio
import logging
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from src.auth.dependencies import get_current_user

logger = logging.getLogger("ai_hubs.ide")

router = APIRouter(prefix="/api/ide", tags=["内置 IDE"])

PLUGINS_FILE = "./data/ide_plugins.json"

DEFAULT_PLUGINS = [
    {"id": "python-runner", "name": "Python 运行器", "description": "在服务器端执行 Python 代码", "installed": True, "icon": "🐍"},
    {"id": "js-runner", "name": "JavaScript 运行器", "description": "在浏览器中运行 JS 代码", "installed": True, "icon": "🟨"},
    {"id": "prettier", "name": "代码格式化", "description": "自动格式化代码排版", "installed": False, "icon": "✨"},
    {"id": "linter", "name": "代码检查", "description": "语法和风格检查", "installed": False, "icon": "🔍"},
    {"id": "git-integration", "name": "Git 集成", "description": "内置 Git 版本控制", "installed": False, "icon": "🔀"},
    {"id": "theme-customizer", "name": "主题定制", "description": "自定义编辑器配色方案", "installed": False, "icon": "🎨"},
    {"id": "snippets", "name": "代码片段", "description": "常用代码模板快速插入", "installed": False, "icon": "📋"},
    {"id": "vscode-remote", "name": "VS Code 远程", "description": "连接 VS Code Server 远程开发", "installed": False, "icon": "🔗"},
]


# ============================================================
# 代码执行
# ============================================================

class RunCodeRequest(BaseModel):
    language: str = Field("python", description="语言: python / javascript / html")
    code: str = Field(..., description="待执行代码")


@router.post("/run")
async def api_run_code(req: RunCodeRequest, current_user=Depends(get_current_user)):
    """在服务端执行代码（Python 走子进程，JS/HTML 由前端处理）"""
    if req.language == "python":
        if not req.code.strip():
            return {"ok": True, "language": "python", "output": "", "exit_code": 0}
        # 探测可用的 Python 解释器
        python_bin = os.environ.get("PYTHON_EXECUTABLE") or "python3"
        import shutil
        if not shutil.which(python_bin):
            python_bin = "python"
        try:
            proc = await asyncio.create_subprocess_exec(
                python_bin, "-c", req.code,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
            except asyncio.TimeoutError:
                proc.kill()
                return {"ok": True, "language": "python",
                        "output": "⏱ 执行超时（限制 20 秒）", "exit_code": -1, "timed_out": True}
            out = (stdout or b"").decode("utf-8", errors="replace")
            err = (stderr or b"").decode("utf-8", errors="replace")
            output = out
            if err:
                output += ("\n" if output else "") + err
            return {"ok": True, "language": "python", "output": output, "exit_code": proc.returncode}
        except FileNotFoundError:
            return {"ok": False, "error": "未找到 Python 解释器，无法在服务器端运行"}
        except Exception as e:
            return {"ok": True, "language": "python", "output": f"错误: {e}", "exit_code": -1}
    else:
        return {"ok": False, "error": f"语言 {req.language} 不支持服务器端执行，请使用前端运行"}


# ============================================================
# 插件市场
# ============================================================

def _load_plugins() -> list[dict]:
    if os.path.exists(PLUGINS_FILE):
        try:
            with open(PLUGINS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            by_id = {p["id"]: p for p in saved}
            result = []
            for p in DEFAULT_PLUGINS:
                if p["id"] in by_id:
                    merged = dict(p)
                    merged["installed"] = by_id[p["id"]].get("installed", p["installed"])
                    result.append(merged)
                else:
                    result.append(dict(p))
            return result
        except Exception:
            pass
    return [dict(p) for p in DEFAULT_PLUGINS]


def _save_plugins(plugins: list[dict]) -> None:
    os.makedirs(os.path.dirname(PLUGINS_FILE), exist_ok=True)
    with open(PLUGINS_FILE, "w", encoding="utf-8") as f:
        json.dump(plugins, f, ensure_ascii=False, indent=2)


@router.get("/plugins")
async def api_list_plugins(current_user=Depends(get_current_user)):
    """列出可用扩展插件及其安装状态"""
    return {"ok": True, "plugins": _load_plugins()}


class PluginToggleRequest(BaseModel):
    plugin_id: str = Field(..., description="插件 ID")
    installed: bool = Field(True, description="安装/卸载")


@router.post("/plugins/toggle")
async def api_toggle_plugin(req: PluginToggleRequest, current_user=Depends(get_current_user)):
    """安装或卸载插件"""
    plugins = _load_plugins()
    found = False
    for p in plugins:
        if p["id"] == req.plugin_id:
            p["installed"] = req.installed
            found = True
            break
    if not found:
        return JSONResponse({"ok": False, "error": "插件不存在"}, status_code=404)
    _save_plugins(plugins)
    return {"ok": True, "plugins": plugins}
