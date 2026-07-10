# -*- coding: utf-8 -*-
"""技能模型"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, Text, Boolean, Integer, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Skill(Base):
    """技能表"""
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(64), default="general", index=True)
    source: Mapped[str] = mapped_column(String(32), default="builtin")  # builtin | github | custom
    github_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_installed: Mapped[bool] = mapped_column(Boolean, default=False)
    installed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "source": self.source,
            "github_url": self.github_url,
            "version": self.version,
            "config": self.config or {},
            "is_installed": self.is_installed,
            "installed_at": self.installed_at.isoformat() if self.installed_at else None,
        }
