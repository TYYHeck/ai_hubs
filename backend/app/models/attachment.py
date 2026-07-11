# -*- coding: utf-8 -*-
"""附件模型 — 对话中上传的图片/文件，通过占位符引用（[image#1] / [Doc #1]）"""

from __future__ import annotations
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Attachment(Base):
    """对话附件表"""
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # 所属对话（可选，上传后可暂不绑定）
    conversation_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # 序号：同一对话内按上传顺序编号，用于 [image#1] / [Doc #1]
    ref_index: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(16), default="file")  # image | doc | file
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    mime_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)  # 相对 DATA_DIR/uploads 的路径
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="attachments")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "ref_index": self.ref_index,
            "kind": self.kind,
            "filename": self.filename,
            "mime_type": self.mime_type,
            "size": self.size,
            "url": f"/api/v1/uploads/{self.id}",
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
