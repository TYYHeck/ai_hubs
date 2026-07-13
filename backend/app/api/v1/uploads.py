# -*- coding: utf-8 -*-
"""
附件上传 API — 对话中的图片/文件上传与访问

上传后按对话内顺序编号，前端以占位符引用：
  - 图片: [image#N]
  - 文档: [Doc #N]
  - 其他: [file#N]
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.user import User
from ...models.attachment import Attachment
from ..deps import get_current_user
from ...config import DATA_DIR

router = APIRouter(prefix="/uploads", tags=["附件"])

_UPLOAD_ROOT = DATA_DIR / "uploads"
_MAX_BYTES = 20 * 1024 * 1024  # 单文件上限 20MB
_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
_DOC_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml"}


def _kind_for(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in _IMAGE_EXT:
        return "image"
    if ext in _DOC_EXT:
        return "doc"
    return "file"


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    conversation_id: str | None = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """上传附件，返回占位符引用信息。"""
    raw = await file.read()
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件过大（上限 20MB）")
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")

    # 计算同一对话下的序号
    if conversation_id:
        result = await session.execute(
            select(Attachment).where(
                Attachment.user_id == current_user.id,
                Attachment.conversation_id == conversation_id,
            )
        )
        existing = result.scalars().all()
        next_index = (max((a.ref_index for a in existing), default=0)) + 1
    else:
        next_index = 0

    # 落盘（按用户分目录）
    user_dir = _UPLOAD_ROOT / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "file").suffix
    stored_name = f"{uuid.uuid4().hex}{ext}"
    disk_path = user_dir / stored_name
    with open(disk_path, "wb") as f:
        f.write(raw)

    kind = _kind_for(file.filename or "file")
    att = Attachment(
        user_id=current_user.id,
        conversation_id=conversation_id,
        ref_index=next_index,
        kind=kind,
        filename=file.filename or stored_name,
        mime_type=file.content_type,
        size=len(raw),
        storage_path=f"{current_user.id}/{stored_name}",
    )
    session.add(att)
    await session.commit()
    await session.refresh(att)

    # 始终生成带编号的占位符（兼容 _resolve_attachments 的正则匹配）
    placeholder = f"[{kind}#{next_index}]"
    return {
        "ok": True,
        "attachment": att.to_dict(),
        "placeholder": placeholder,  # 如 [image#1] / [Doc #2] / [file]
        "kind": kind,
    }


@router.get("/{attachment_id}")
async def get_file(
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """访问附件文件（仅本人可访问）。"""
    att = await session.get(Attachment, attachment_id)
    if not att or att.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="附件不存在")
    disk_path = _UPLOAD_ROOT / att.storage_path
    if not disk_path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(
        str(disk_path),
        media_type=att.mime_type or "application/octet-stream",
        filename=att.filename,
    )


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除附件。"""
    att = await session.get(Attachment, attachment_id)
    if not att or att.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="附件不存在")
    disk_path = _UPLOAD_ROOT / att.storage_path
    if disk_path.exists():
        try:
            os.remove(disk_path)
        except OSError:
            pass
    await session.delete(att)
    await session.commit()
