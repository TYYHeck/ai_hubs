# -*- coding: utf-8 -*-
"""任务模型 + 任务事件"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, Text, Integer, DateTime, JSON, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Task(Base):
    """任务表"""
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # pending | running | paused | completed | failed | cancelled
    priority: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    assigned_agent: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # 编排配置
    mode: Mapped[str] = mapped_column(String(32), default="single")  # 8种模式
    think_depth: Mapped[int] = mapped_column(Integer, default=1)      # 1-3
    think_visibility: Mapped[str] = mapped_column(String(16), default="visible")
    # visible | hidden | folded

    # 结果
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联
    user = relationship("User", back_populates="tasks")
    events = relationship("TaskEvent", back_populates="task", cascade="all, delete-orphan",
                          order_by="TaskEvent.created_at")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": (self.description or "")[:200],
            "status": self.status,
            "priority": self.priority,
            "tags": self.tags or [],
            "assigned_agent": self.assigned_agent,
            "mode": self.mode,
            "think_depth": self.think_depth,
            "think_visibility": self.think_visibility,
            "result": (self.result or "")[:500],
            "error": self.error,
            "metadata": self.metadata_ or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


class TaskEvent(Base):
    """任务事件日志"""
    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    task = relationship("Task", back_populates="events")

    def to_dict(self) -> dict:
        return {
            "time": self.created_at.isoformat(timespec="seconds") if self.created_at else None,
            "event": self.event,
            "data": self.data,
        }
