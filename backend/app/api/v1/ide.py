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

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

import mimetypes
import urllib.parse

from ...config import DATA_DIR
from ...core.sandbox import _workspace_root, _resolve, _dir_size, _enforce_quota, _resolve_safe, _enforce_quota_http, _execute_file
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


# ═══════════════════════════════════════════════════════════
# 上传（multipart，支持任意文件，含二进制/二进制/Office）
# ═══════════════════════════════════════════════════════════

@router.post("/files/upload", status_code=status.HTTP_201_CREATED)
async def upload_file(
    path: str = Form(..., description="目标相对路径（含文件名，如 data/report.pdf）"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """上传文件到工作区指定路径（multipart/form-data）。

    - 适合上传二进制文件（PPT/DOCX/XLSX/PDF/图片 等），不受 500MB 配额限制（但受配额总量约束）
    - 自动创建父目录
    - 文件名与 `path` 末段不一致时，使用 path 的末段作最终名
    """
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if target.is_dir():
        raise HTTPException(status_code=400, detail="路径是目录")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="空文件")

    try:
        existing = target.stat().st_size if target.exists() else 0
    except OSError:
        existing = 0
    new_bytes = len(content)
    _enforce_quota_http(root, max(0, new_bytes - existing))

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_bytes(content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"写入失败: {e}")
    return {
        "path": path,
        "name": target.name,
        "size": target.stat().st_size,
        "mime_type": file.content_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream",
    }


# ═══════════════════════════════════════════════════════════
# 预览：直接返回文件内容（带正确 Content-Type），供浏览器内嵌查看
# ═══════════════════════════════════════════════════════════

_PREVIEWABLE_TEXT_EXT = {
    ".txt", ".md", ".json", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".java", ".go", ".rs", ".rb", ".php", ".sh", ".bash",
    ".ini", ".cfg", ".toml", ".env", ".gitignore", ".sql",
}


@router.get("/files/preview")
async def preview_file(
    path: str = Query(..., description="相对路径"),
    inline: bool = Query(True, description="True=浏览器内嵌打开，False=强制下载"),
    current_user: User = Depends(get_current_user),
):
    """预览/下载文件：浏览器内嵌打开（图片/PDF/音视频/文本）或直接返回字节流。

    - 文本类（≤1MB）直接返回 UTF-8
    - 图片/PDF/视频 直接返回字节 + Content-Disposition: inline
    - 其他二进制（如 pptx/docx/xlsx）默认走 inline（office 浏览器/Office Online 可在线打开）
    """
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = target.suffix.lower()
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"

    # 文本文件 → 直接返回文本，便于前端 embed 显示
    if ext in _PREVIEWABLE_TEXT_EXT:
        try:
            raw = target.read_bytes()
            if len(raw) > 1 * 1024 * 1024:
                # 超过 1MB 的文本走 download，避免大响应
                return FileResponse(str(target), filename=target.name, media_type="text/plain; charset=utf-8")
            text = raw.decode("utf-8", errors="replace")
            return Response(
                content=text,
                media_type="text/plain; charset=utf-8",
                headers={"Content-Disposition": f'inline; filename*=UTF-8\'\'{urllib.parse.quote(target.name)}'},
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"读取失败: {e}")

    # 二进制文件（图片/PDF/音视频/Office）
    disposition = "inline" if inline else "attachment"
    return FileResponse(
        path=str(target),
        media_type=mime,
        filename=target.name,
        headers={"Content-Disposition": f'{disposition}; filename*=UTF-8\'\'{urllib.parse.quote(target.name)}'},
    )


@router.get("/files/info")
async def file_info(
    path: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """获取文件元信息（用于前端预览/下载时的决策：mime/大小/是否文本）。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    ext = target.suffix.lower()
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return {
        "path": path,
        "name": target.name,
        "size": target.stat().st_size,
        "ext": ext,
        "mime": mime,
        "is_text": ext in _PREVIEWABLE_TEXT_EXT,
        "is_image": mime.startswith("image/"),
        "is_pdf": mime == "application/pdf",
        "is_media": mime.startswith("audio/") or mime.startswith("video/"),
    }


@router.get("/files/download")
async def download_file(
    path: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """下载文件：强制 Content-Disposition: attachment。"""
    root = _workspace_root(current_user.id)
    target = _resolve_safe(root, path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(target),
        media_type=mime,
        filename=target.name,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(target.name)}"},
    )
