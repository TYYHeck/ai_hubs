# -*- coding: utf-8 -*-
"""Agent 配置模型"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, Text, Boolean, Integer, DateTime, JSON, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Agent(Base):
    """Agent 配置表"""
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(512), default="")
    system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # LLM 配置
    model: Mapped[str] = mapped_column(String(64), default="deepseek-chat")
    provider: Mapped[str] = mapped_column(String(32), default="deepseek")

    # 配置来源：global（使用全局 LLM 配置）| self（使用本 Agent 自带 provider/model）
    config_mode: Mapped[str] = mapped_column(String(16), default="global")

    # 是否为全局默认 Agent（每个用户至多一个）
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    # 能力开关
    enable_planning: Mapped[bool] = mapped_column(Boolean, default=False)
    enable_rag: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_reflection: Mapped[bool] = mapped_column(Boolean, default=False)

    # 配置
    max_iterations: Mapped[int] = mapped_column(Integer, default=15)
    memory_strength: Mapped[float] = mapped_column(Float, default=3.0)  # 0-5 记忆强度
    setup_mode: Mapped[str] = mapped_column(String(16), default="detailed")  # quick | detailed

    # 关联配置
    skills: Mapped[list] = mapped_column(JSON, default=list)      # 技能名列表
    tags: Mapped[list] = mapped_column(JSON, default=list)        # 标签
    category: Mapped[str] = mapped_column(String(64), default="general")  # 数据库分类

    # 运行状态
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | idle | running | error
    current_task_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联
    user = relationship("User", back_populates="agents")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "model": self.model,
            "provider": self.provider,
            "config_mode": self.config_mode,
            "is_default": self.is_default,
            "enable_planning": self.enable_planning,
            "enable_rag": self.enable_rag,
            "enable_reflection": self.enable_reflection,
            "max_iterations": self.max_iterations,
            "memory_strength": self.memory_strength,
            "setup_mode": self.setup_mode,
            "skills": self.skills or [],
            "tags": self.tags or [],
            "category": self.category,
            "status": self.status,
            "current_task_id": self.current_task_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
