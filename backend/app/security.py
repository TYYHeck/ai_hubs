# -*- coding: utf-8 -*-
"""
安全工具 — JWT 令牌 + 密码哈希
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt
import bcrypt

from .config import settings


def hash_password(password: str) -> str:
    """哈希密码（原生 bcrypt，避免 passlib 与新版 bcrypt 的兼容问题）"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """验证密码"""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """创建 JWT 访问令牌"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=settings.auth.jwt_expire_hours)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(
        to_encode,
        settings.auth.jwt_secret,
        algorithm=settings.auth.jwt_algorithm,
    )


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """解码 JWT 令牌，失败返回 None"""
    try:
        payload = jwt.decode(
            token,
            settings.auth.jwt_secret,
            algorithms=[settings.auth.jwt_algorithm],
        )
        return payload
    except JWTError:
        return None
