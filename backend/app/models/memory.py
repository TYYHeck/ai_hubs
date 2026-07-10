# -*- coding: utf-8 -*-
"""记忆模型 — VCS 版本控制 + 快照"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, Text, Integer, DateTime, JSON, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MemoryCommit(Base):
    """记忆版本提交（git 式）"""
    __tablename__ = "memory_commits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    agent_name: Mapped[str] = mapped_column(String(128), default="default", index=True)
    commit_hash: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    message: Mapped[str] = mapped_column(String(256), default="")
    parent_hash: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    snapshots = relationship("MemorySnapshot", back_populates="commit", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "commit_hash": self.commit_hash,
            "message": self.message,
            "parent_hash": self.parent_hash,
            "message_count": self.message_count,
            "summary": (self.summary or "")[:200],
            "agent_name": self.agent_name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MemorySnapshot(Base):
    """记忆快照（commit 的具体数据）"""
    __tablename__ = "memory_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    commit_id: Mapped[int] = mapped_column(ForeignKey("memory_commits.id", ondelete="CASCADE"), nullable=False, index=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)  # 完整记忆快照
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    commit = relationship("MemoryCommit", back_populates="snapshots")
