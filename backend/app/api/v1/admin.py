# -*- coding: utf-8 -*-
"""后台管理路由 — 仪表盘统计 + 用户管理（仅管理员）"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.user import User
from ...models.agent import Agent
from ...models.skill import Skill
from ...models.dataset import Dataset
from ...models.task import Task
from ...models.conversation import Conversation, Message
from ..deps import get_current_admin
from ...schemas.admin import AdminUserUpdate

router = APIRouter(prefix="/admin", tags=["后台管理"])


# ============================================================
# 仪表盘统计
# ============================================================

@router.get("/dashboard")
async def dashboard(
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """系统概览统计"""
    # 用户统计
    total_users = (await session.execute(select(func.count()).select_from(User))).scalar() or 0
    active_users = (await session.execute(
        select(func.count()).select_from(User).where(User.is_active == True)  # noqa: E712
    )).scalar() or 0
    admin_users = (await session.execute(
        select(func.count()).select_from(User).where(User.role == "admin")
    )).scalar() or 0

    # 资源统计
    total_agents = (await session.execute(select(func.count()).select_from(Agent))).scalar() or 0
    total_datasets = (await session.execute(select(func.count()).select_from(Dataset))).scalar() or 0
    total_tasks = (await session.execute(select(func.count()).select_from(Task))).scalar() or 0
    total_conversations = (await session.execute(select(func.count()).select_from(Conversation))).scalar() or 0
    total_messages = (await session.execute(select(func.count()).select_from(Message))).scalar() or 0

    # 技能按来源分组
    skill_rows = (await session.execute(
        select(Skill.source, func.count()).group_by(Skill.source)
    )).all()
    skills_by_source = {src or "unknown": cnt for src, cnt in skill_rows}
    total_skills = sum(skills_by_source.values())

    # 最近 7 天注册用户
    since = datetime.utcnow() - timedelta(days=7)
    recent_users = (await session.execute(
        select(func.count()).select_from(User).where(User.created_at >= since)
    )).scalar() or 0

    # 最近注册的用户（前 5）
    latest = (await session.execute(
        select(User).order_by(User.created_at.desc()).limit(5)
    )).scalars().all()

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "admins": admin_users,
            "recent_7d": recent_users,
        },
        "agents": {"total": total_agents},
        "skills": {"total": total_skills, "by_source": skills_by_source},
        "datasets": {"total": total_datasets},
        "tasks": {"total": total_tasks},
        "conversations": {"total": total_conversations},
        "messages": {"total": total_messages},
        "latest_users": [u.to_dict() for u in latest],
    }


# ============================================================
# 用户管理
# ============================================================

@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="用户名/邮箱模糊搜索"),
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """用户列表（分页 + 搜索）"""
    like = f"%{search}%" if search else None
    search_cond = (
        (User.username.ilike(like)) | (User.email.ilike(like)) if like else None
    )

    count_stmt = select(func.count()).select_from(User)
    if search_cond is not None:
        count_stmt = count_stmt.where(search_cond)
    total = (await session.execute(count_stmt)).scalar() or 0

    stmt = select(User)
    if search_cond is not None:
        stmt = stmt.where(search_cond)
    rows = (await session.execute(
        stmt.order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    return {
        "items": [u.to_dict() for u in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """用户详情"""
    user = (await session.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    return user.to_dict()


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    req: AdminUserUpdate,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """更新用户（角色/启用状态/邮箱）"""
    user = (await session.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")

    data = req.model_dump(exclude_unset=True)

    if "role" in data:
        role = data["role"]
        if role not in ("admin", "user"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "role 必须是 admin 或 user")
        # 防止管理员降级自己
        if user.id == admin.id and role != "admin":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能修改自己的管理员角色")
        user.role = role

    if "is_active" in data:
        # 防止管理员禁用自己
        if user.id == admin.id and data["is_active"] is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能禁用自己的账户")
        user.is_active = data["is_active"]

    if "email" in data and data["email"]:
        email = data["email"].strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "邮箱格式不正确")
        user.email = email

    await session.commit()
    await session.refresh(user)
    return user.to_dict()


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """删除用户（不能删除自己）"""
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能删除自己的账户")

    user = (await session.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")

    await session.delete(user)
    await session.commit()
    return {"ok": True, "message": f"用户 {user.username} 已删除"}
