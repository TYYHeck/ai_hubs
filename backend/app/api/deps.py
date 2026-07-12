# -*- coding: utf-8 -*-
"""FastAPI 依赖注入 — 认证"""

from __future__ import annotations
from typing import Optional

from fastapi import Depends, HTTPException, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models.user import User
from ..security import decode_access_token

_security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
    session: AsyncSession = Depends(get_session),
    token: Optional[str] = Query(None, description="可选：通过 URL query 参数传递 token（用于下载/预览等无法设置 header 的场景）"),
) -> User:
    """获取当前认证用户（必须登录）

    支持两种认证方式：
    1. Authorization: Bearer <token> header（推荐）
    2. ?token=<token> query 参数（用于文件下载/预览等无法设置 header 的场景）
    """
    token_str = None
    if credentials:
        token_str = credentials.credentials
    elif token:
        token_str = token

    if token_str is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未提供认证令牌",
                            headers={"WWW-Authenticate": "Bearer"})

    payload = decode_access_token(token_str)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "令牌无效或已过期",
                            headers={"WWW-Authenticate": "Bearer"})

    username = payload.get("sub", "")
    if not username:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "令牌内容无效")

    result = await session.execute(
        select(User).where(User.username == username, User.is_active == True)  # noqa: E712
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已被禁用")

    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
    session: AsyncSession = Depends(get_session),
    token: Optional[str] = Query(None, description="可选：通过 URL query 参数传递 token"),
) -> Optional[User]:
    """获取当前用户（可选，未登录返回 None）"""
    try:
        return await get_current_user(credentials, session, token)
    except HTTPException:
        return None


async def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """获取当前管理员（必须 admin 角色）"""
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "需要管理员权限")
    return current_user
