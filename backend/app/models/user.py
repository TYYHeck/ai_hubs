# -*- coding: utf-8 -*-
"""用户模型 + 验证码"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import String, Text, Boolean, Integer, DateTime, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class User(Base):
    """用户表"""
    __tablename__ = "users"

    # 非管理员默认 token 配额（对话 LLM 用量上限），管理员不受限
    DEFAULT_TOKEN_QUOTA = 10000

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    email: Mapped[str] = mapped_column(String(128), default="", index=True)
    role: Mapped[str] = mapped_column(String(16), default="user")  # admin | user
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # 主题、字体等偏好
    # 用户个人的 LLM 配置（provider/model/api_key/base_url）。为空则使用平台全局免费配置（受 token 配额限制）。
    llm_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # 关联
    agents = relationship("Agent", back_populates="user", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")

    def get_token_quota(self) -> Optional[int]:
        """返回 token 配额（None 表示不限）。管理员不限；其余默认 1w。"""
        if self.role == "admin":
            return None
        q = (self.preferences or {}).get("token_quota")
        return int(q) if q is not None else self.DEFAULT_TOKEN_QUOTA

    def get_token_used(self) -> int:
        return int((self.preferences or {}).get("token_used", 0) or 0)

    def add_token_usage(self, n: int) -> None:
        prefs = dict(self.preferences or {})
        prefs["token_used"] = self.get_token_used() + max(0, int(n))
        self.preferences = prefs

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "is_active": self.is_active,
            "preferences": self.preferences or {},
            "token_quota": self.get_token_quota(),
            "token_used": self.get_token_used(),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
        }


class VerificationCode(Base):
    """邮箱验证码"""
    __tablename__ = "verification_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(8), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), default="register")  # register | reset
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_vcode_email_purpose", "email", "purpose"),
    )
