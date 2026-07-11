# -*- coding: utf-8 -*-
"""记忆模型 — VCS 版本控制(git式) + 扁平记忆条目(关键词索引)

设计目标（对应需求「多层保障防幻觉」）：
  - MemoryBranch : 每 (user_id, agent_name) 一条分支，记录当前 HEAD commit
  - MemoryCommit : git 式提交（commit_hash / parent_hash / message / summary）
  - MemoryEntry  : 扁平记忆条目，带关键词索引 + 重要性，支持快速检索与记忆图谱
  - MemorySnapshot: 提交时刻的完整记忆快照（用于精确回退）
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    String,
    Text,
    Integer,
    DateTime,
    JSON,
    Float,
    Boolean,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MemoryBranch(Base):
    """记忆分支：跟踪每 (用户, Agent) 的当前 HEAD 提交"""

    __tablename__ = "memory_branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    agent_name: Mapped[str] = mapped_column(String(128), default="default", index=True)
    head_hash: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (UniqueConstraint("user_id", "agent_name", name="uq_memory_branch"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "agent_name": self.agent_name,
            "head_hash": self.head_hash,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class MemoryCommit(Base):
    """记忆版本提交（git 式）"""

    __tablename__ = "memory_commits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    agent_name: Mapped[str] = mapped_column(String(128), default="default", index=True)
    commit_hash: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    message: Mapped[str] = mapped_column(String(256), default="")
    parent_hash: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    commit_type: Mapped[str] = mapped_column(String(16), default="turn")  # turn | rollback | compress
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    snapshots = relationship("MemorySnapshot", back_populates="commit", cascade="all, delete-orphan")
    entries = relationship("MemoryEntry", back_populates="commit", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "commit_hash": self.commit_hash,
            "message": self.message,
            "parent_hash": self.parent_hash,
            "message_count": self.message_count,
            "summary": (self.summary or "")[:500],
            "commit_type": self.commit_type,
            "agent_name": self.agent_name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MemoryEntry(Base):
    """扁平记忆条目 — 带关键词索引与重要性，支持快速检索与记忆图谱"""

    __tablename__ = "memory_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    agent_name: Mapped[str] = mapped_column(String(128), default="default", index=True)
    commit_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("memory_commits.id", ondelete="CASCADE"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(16), default="user")  # user | assistant | system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    keywords: Mapped[list] = mapped_column(JSON, default=list)  # 关键词列表（记忆图谱节点）
    importance: Mapped[float] = mapped_column(Float, default=1.0)  # 0-5 重要性
    compressed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)  # 是否已被压缩归档
    seq: Mapped[int] = mapped_column(Integer, default=0)  # 条目序号（时间序）
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    commit = relationship("MemoryCommit", back_populates="entries")

    __table_args__ = (
        Index("ix_memory_entry_user_agent_seq", "user_id", "agent_name", "seq"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "keywords": self.keywords or [],
            "importance": self.importance,
            "seq": self.seq,
            "commit_id": self.commit_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MemorySnapshot(Base):
    """记忆快照（commit 时刻的完整记忆，用于精确回退）"""

    __tablename__ = "memory_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    commit_id: Mapped[int] = mapped_column(
        ForeignKey("memory_commits.id", ondelete="CASCADE"), nullable=False, index=True
    )
    data: Mapped[dict] = mapped_column(JSON, nullable=False)  # 完整记忆快照
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    commit = relationship("MemoryCommit", back_populates="snapshots")
