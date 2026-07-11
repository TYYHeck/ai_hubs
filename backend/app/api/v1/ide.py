# -*- coding: utf-8 -*-
"""
内置 IDE API — 文件系统 + 运行

工作区按用户隔离：{DATA_DIR}/ide_workspace/{user_id}/。
所有路径均做越界校验（realpath 必须位于工作区内），杜绝目录穿越。
运行功能：以工作区为受限环境，按扩展名选择解释器执行脚本，带超时与输出捕获
（仅支持 python / node / bash，便于快速验证 Agent 代码与技能脚本）。

实际执行逻辑已抽取至 app.core.sandbox 模块，供 IDE API 与 Agent 工具链共用。
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import DATA_DIR
from ...core.sandbox import _workspace_root, _resolve, _dir_size, _enforce_quota, _execute_file
from ...database import get_session
from ...models.user import User
from ..deps import get_current_user

router = APIRouter(prefix="/ide", tags=["IDE"])

_USER_QUOTA_BYTES = 500 * 1024 * 1024  # 每个用户工作区配额：500MB


# ── 请求模型 ──

class FileWriteRequest(BaseModel):
    path: str
    content: str = ""
    encoding: str = "utf-8"


class MkdirRequest(BaseModel):
    path: str


class RunRequest(BaseModel):
    path: str
    args: list[str] = []


class RunResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    command: str


# ── 路径工具（IDE 特定：_resolve 抛 HTTPException）──

def _resolve_safe(root: Path, rel: str) -> Path:
    """将相对路径解析为绝对路径并校验不越界（HTTP 版本，抛 HTTPException）。"""
    if not rel:
        raise HTTPException(status_code=400, detail="路径不能为空")
    try:
        return _resolve(root, rel)
    except PermissionError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _enforce_quota_http(root: Path, extra_bytes: int = 0) -> None:
    """配额校验（HTTP 版本，抛 HTTPException）。"""
    try:
        _enforce_quota(root, extra_bytes)
    except PermissionError as e:
        used = _dir_size(root)
        free = max(0, _USER_QUOTA_BYTES - used)
        raise HTTPException(
            status_code=413,
            detail=(
                f"工作区空间不足：配额 {_USER_QUOTA_BYTES // (1024 * 1024)}MB，"
                f"已用约 {used // (1024 * 1024)}MB，剩余约 {free // (1024 * 1024)}MB，"
                f"本次需写入约 {extra_bytes // 1024}KB"
            ),
        )


def _tree(root: Path, base: Path, depth: int = 0, max_depth: int = 6) -> dict:
    """构建目录树（限制深度，避免巨大目录拖垮响应）。"""
    node = {
        "name": base.name or root.name,
        "path": str(base.relative_to(root)).replace("\\", "/"),
        "type": "dir" if base.is_dir() else "file",
        "children": [],
    }
    if base.is_file():
        try:
            node["size"] = base.stat().st_size
        except OSError:
            node["size"] = 0
        return node
    if depth >= max_depth:
        node["truncated"] = True
        return node
    try:
        entries = sorted(base.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except OSError:
        return node
    for child in entries:
        if child.name.startswith(".") and child.name not in (".", ".."):
            if child.is_dir():
                continue
        node["children"].append(_tree(root, child, depth + 1, max_depth))
    return node


# ── 端点 ──

@router.get("/tree")
async def get_tree(current_user: User = Depends(get_current_user)):
    """获取用户工作区目录树（含配额使用信息）。"""
    root = _workspace_root(current_user.id)
    return {
        "tree": _tree(root, root),
        "usage": {
            "used": _dir_size(root),
            "quota": _USER_QUOTA_BYTES,
        },
    }


@router.get("/files/download")
async def download_file(
    path: str = "",
    current_user: User = Depends(get_current_user),
):
    """下载工作区文件（二进制流，支持 pptx/docx/xlsx/pdf 等）。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if target.is_dir():
        raise HTTPException(status_code=400, detail="目标是目录，无法下载")
    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type="application/octet-stream",
    )


@router.get("/file")
async def read_file(
    path: str = "",
    current_user: User = Depends(get_current_user),
):
    """读取文件内容（文本）。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if target.is_dir():
        raise HTTPException(status_code=400, detail="目标是目录，无法读取内容")
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"读取失败: {e}")
    return {
        "path": path,
        "name": target.name,
        "content": content,
        "size": target.stat().st_size,
    }


@router.post("/file", status_code=status.HTTP_201_CREATED)
async def write_file(
    body: FileWriteRequest,
    current_user: User = Depends(get_current_user),
):
    """写入/创建文件（自动创建父目录，受 500MB 配额限制）。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, body.path)
    if target.is_dir():
        raise HTTPException(status_code=400, detail="路径是目录")
    try:
        existing = target.stat().st_size if target.exists() else 0
    except OSError:
        existing = 0
    new_bytes = len(body.content.encode(body.encoding, errors="replace"))
    _enforce_quota_http(root, max(0, new_bytes - existing))
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_text(body.content, encoding=body.encoding)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"写入失败: {e}")
    return {"path": body.path, "name": target.name, "size": target.stat().st_size}


@router.post("/mkdir", status_code=status.HTTP_201_CREATED)
async def make_dir(
    body: MkdirRequest,
    current_user: User = Depends(get_current_user),
):
    """创建目录。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, body.path)
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"创建目录失败: {e}")
    return {"path": body.path, "type": "dir"}


@router.delete("/file", status_code=status.HTTP_204_NO_CONTENT)
async def delete_path(
    path: str = "",
    current_user: User = Depends(get_current_user),
):
    """删除文件或目录。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="路径不存在")
    if target == root.resolve():
        raise HTTPException(status_code=400, detail="不能删除工作区根目录")
    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"删除失败: {e}")


@router.post("/run", response_model=RunResponse)
async def run_file(
    body: RunRequest,
    current_user: User = Depends(get_current_user),
):
    """在受限工作区内运行脚本（python / node / bash / C / C++ / Java）。"""
    root = _workspace_root(current_user.id)

    # 解析路径并校验文件存在
    p = Path(body.path)
    if p.is_absolute():
        target = _resolve_safe(root, body.path)
    else:
        target = _resolve_safe(root, body.path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    result = _execute_file(str(target), current_user.id, list(body.args))
    return RunResponse(
        stdout=result["stdout"],
        stderr=result["stderr"],
        exit_code=result["exit_code"],
        timed_out=result["timed_out"],
        command=result["command"],
    )
