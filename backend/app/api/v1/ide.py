# -*- coding: utf-8 -*-
"""
内置 IDE API — 文件系统 + 运行

工作区按用户隔离：{DATA_DIR}/ide_workspace/{user_id}/。
所有路径均做越界校验（realpath 必须位于工作区内），杜绝目录穿越。
运行功能：以工作区为受限环境，按扩展名选择解释器执行脚本，带超时与输出捕获
（仅支持 python / node / bash，便于快速验证 Agent 代码与技能脚本）。
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import DATA_DIR
from ...database import get_session
from ...models.user import User
from ..deps import get_current_user

router = APIRouter(prefix="/ide", tags=["IDE"])

_RUN_TIMEOUT = 15  # 秒

# 扩展名 → 解释器命令
_INTERPRETERS = {
    ".py": ["python3", "python"],
    ".js": ["node"],
    ".mjs": ["node"],
    ".sh": ["bash"],
    ".pl": ["perl"],
}


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


# ── 路径工具 ──

def _root(user_id: int) -> Path:
    root = DATA_DIR / "ide_workspace" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _resolve(root: Path, rel: str) -> Path:
    """将相对路径解析为绝对路径并校验不越界（防目录穿越）。"""
    if not rel:
        raise HTTPException(status_code=400, detail="路径不能为空")
    target = (root / rel).resolve()
    root_resolved = root.resolve()
    # 允许 target == root 或 target 位于 root 内部
    if target != root_resolved and root_resolved not in target.parents:
        raise HTTPException(status_code=400, detail="非法路径（越界）")
    return target


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
            # 跳过隐藏目录（如 .git）以免爆炸
            if child.is_dir():
                continue
        node["children"].append(_tree(root, child, depth + 1, max_depth))
    return node


# ── 端点 ──

@router.get("/tree")
async def get_tree(current_user: User = Depends(get_current_user)):
    """获取用户工作区目录树。"""
    root = _root(current_user.id)
    return _tree(root, root)


@router.get("/file")
async def read_file(
    path: str = "",
    current_user: User = Depends(get_current_user),
):
    """读取文件内容（文本）。"""
    root = _root(current_user.id)
    target = _resolve(root, path)
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
    """写入/创建文件（自动创建父目录）。"""
    root = _root(current_user.id)
    target = _resolve(root, body.path)
    if target.is_dir():
        raise HTTPException(status_code=400, detail="路径是目录")
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
    root = _root(current_user.id)
    target = _resolve(root, body.path)
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
    root = _root(current_user.id)
    target = _resolve(root, path)
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
    """在受限工作区内运行脚本（python / node / bash）。"""
    root = _root(current_user.id)
    target = _resolve(root, body.path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = target.suffix.lower()
    if ext not in _INTERPRETERS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型 {ext}，仅支持: " + ", ".join(sorted(_INTERPRETERS.keys())),
        )
    # 选首个可用的解释器
    candidates = _INTERPRETERS[ext]
    exe = None
    for c in candidates:
        if shutil.which(c):
            exe = c
            break
    if exe is None:
        raise HTTPException(status_code=400, detail=f"未找到解释器: {' / '.join(candidates)}")

    cmd = [exe, str(target)] + list(body.args)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(target.parent),
            capture_output=True,
            text=True,
            timeout=_RUN_TIMEOUT,
        )
        return RunResponse(
            stdout=proc.stdout,
            stderr=proc.stderr,
            exit_code=proc.returncode,
            timed_out=False,
            command=" ".join(cmd),
        )
    except subprocess.TimeoutExpired as e:
        return RunResponse(
            stdout=(e.stdout or ""),
            stderr=f"执行超时（>{_RUN_TIMEOUT}s），已被终止。\n{(e.stderr or '')}",
            exit_code=-1,
            timed_out=True,
            command=" ".join(cmd),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"运行失败: {e}")
