# -*- coding: utf-8 -*-
"""后台管理路由 — 仪表盘统计 + 用户管理 + Agent/技能管理（仅管理员）"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.user import User
from ...models.agent import Agent
from ...models.skill import Skill
from ...models.dataset import Dataset
from ...models.task import Task
from ...models.conversation import Conversation, Message
from ..deps import get_current_admin
from ...schemas.admin import (
    AdminUserUpdate, AdminUserQuotaUpdate,
    AdminAgentCopy, AdminSkillSync,
)

logger = logging.getLogger("ai_hubs.admin")
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
    """更新用户（角色/启用状态/邮箱/配额）"""
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
        if user.id == admin.id and role != "admin":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能修改自己的管理员角色")
        user.role = role

    if "is_active" in data:
        if user.id == admin.id and data["is_active"] is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能禁用自己的账户")
        user.is_active = data["is_active"]

    if "email" in data and data["email"]:
        email = data["email"].strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "邮箱格式不正确")
        user.email = email

    if "token_quota" in data and data["token_quota"] is not None:
        prefs = dict(user.preferences or {})
        prefs["token_quota"] = data["token_quota"]
        user.preferences = prefs

    await session.commit()
    await session.refresh(user)
    return user.to_dict()


@router.put("/users/{user_id}/quota")
async def set_user_quota(
    user_id: int,
    req: AdminUserQuotaUpdate,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """设置用户 Token 配额（0 表示不限）"""
    user = (await session.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")

    prefs = dict(user.preferences or {})
    prefs["token_quota"] = max(0, req.token_quota)
    user.preferences = prefs
    await session.commit()
    await session.refresh(user)
    return user.to_dict()


@router.post("/users/{user_id}/reset-usage")
async def reset_user_usage(
    user_id: int,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """重置用户的 Token 使用量"""
    user = (await session.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")

    prefs = dict(user.preferences or {})
    prefs["token_used"] = 0
    user.preferences = prefs
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


# ============================================================
# Agent 管理（全局视图 + 复制/转移）
# ============================================================

@router.get("/agents")
async def list_all_agents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="Agent 名称/描述模糊搜索"),
    user_id: int = Query(None, description="筛选指定用户的 Agent"),
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """列出所有用户的 Agent（分页 + 搜索 + 按用户筛选）"""
    like = f"%{search}%" if search else None

    count_stmt = select(func.count()).select_from(Agent)
    stmt = select(Agent, User.username).join(User, Agent.user_id == User.id)

    if search:
        cond = (Agent.name.ilike(like)) | (Agent.description.ilike(like))
        count_stmt = count_stmt.where(cond)
        stmt = stmt.where(cond)
    if user_id:
        count_stmt = count_stmt.where(Agent.user_id == user_id)
        stmt = stmt.where(Agent.user_id == user_id)

    total = (await session.execute(count_stmt)).scalar() or 0
    rows = (await session.execute(
        stmt.order_by(Agent.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).all()

    items = []
    for agent, username in rows:
        d = agent.to_dict()
        d["owner_username"] = username
        d["owner_id"] = agent.user_id
        items.append(d)

    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.put("/agents/{agent_id}")
async def admin_update_agent(
    agent_id: int,
    data: dict,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """管理员更新任意 Agent 配置"""
    agent = (await session.execute(
        select(Agent).where(Agent.id == agent_id)
    )).scalar_one_or_none()
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent 不存在")

    allowed = {"name", "description", "system_prompt", "model", "provider",
               "config_mode", "enable_planning", "enable_rag", "enable_reflection",
               "max_iterations", "memory_strength", "category", "tags", "skills",
               "is_default", "status"}
    for k, v in data.items():
        if k in allowed and hasattr(agent, k):
            setattr(agent, k, v)

    await session.commit()
    await session.refresh(agent)
    return agent.to_dict()


@router.post("/agents/{agent_id}/copy")
async def copy_agent_to_user(
    agent_id: int,
    req: AdminAgentCopy,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """将 Agent 复制到指定用户（跨账户转移）"""
    src = (await session.execute(
        select(Agent).where(Agent.id == agent_id)
    )).scalar_one_or_none()
    if not src:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "源 Agent 不存在")

    target = (await session.execute(
        select(User).where(User.id == req.target_user_id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "目标用户不存在")

    # 检查同名
    existing = (await session.execute(
        select(Agent).where(
            Agent.user_id == req.target_user_id,
            Agent.name == (req.new_name or src.name),
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"目标用户已有同名 Agent「{req.new_name or src.name}」")

    copied = Agent(
        user_id=req.target_user_id,
        name=req.new_name or src.name,
        description=src.description,
        system_prompt=src.system_prompt,
        model=src.model,
        provider=src.provider,
        config_mode=src.config_mode,
        is_default=False,  # 复制后不作为默认
        enable_planning=src.enable_planning,
        enable_rag=src.enable_rag,
        enable_reflection=src.enable_reflection,
        max_iterations=src.max_iterations,
        memory_strength=src.memory_strength,
        setup_mode=src.setup_mode,
        skills=list(src.skills or []),
        tags=list(src.tags or []),
        category=src.category,
        status="active",
    )
    session.add(copied)
    await session.commit()
    await session.refresh(copied)

    logger.info(f"Admin {admin.username} 复制 Agent {src.name} → 用户 {target.username}")
    return {"ok": True, "agent": copied.to_dict(),
            "message": f"Agent「{copied.name}」已复制到用户 {target.username}"}


@router.delete("/agents/{agent_id}")
async def admin_delete_agent(
    agent_id: int,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """管理员删除任意 Agent"""
    agent = (await session.execute(
        select(Agent).where(Agent.id == agent_id)
    )).scalar_one_or_none()
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent 不存在")

    name = agent.name
    await session.execute(delete(Agent).where(Agent.id == agent_id))
    await session.commit()
    return {"ok": True, "message": f"Agent「{name}」已删除"}


# ============================================================
# 技能管理（全局 CRUD + 同步）
# ============================================================

@router.get("/skills")
async def list_all_skills(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="技能名称/描述模糊搜索"),
    source: str = Query("", description="按来源筛选: builtin/github/custom"),
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """列出所有技能（分页 + 搜索 + 筛选）"""
    like = f"%{search}%" if search else None

    count_stmt = select(func.count()).select_from(Skill)
    stmt = select(Skill)

    if search:
        cond = (Skill.name.ilike(like)) | (Skill.description.ilike(like))
        count_stmt = count_stmt.where(cond)
        stmt = stmt.where(cond)
    if source:
        count_stmt = count_stmt.where(Skill.source == source)
        stmt = stmt.where(Skill.source == source)

    total = (await session.execute(count_stmt)).scalar() or 0
    rows = (await session.execute(
        stmt.order_by(Skill.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()

    return {"items": [s.to_dict() for s in rows], "total": total,
            "page": page, "page_size": page_size}


@router.put("/skills/{skill_id}")
async def admin_update_skill(
    skill_id: int,
    data: dict,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """管理员更新技能配置"""
    skill = (await session.execute(
        select(Skill).where(Skill.id == skill_id)
    )).scalar_one_or_none()
    if not skill:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "技能不存在")

    allowed = {"name", "description", "category", "source",
               "github_url", "version", "config", "is_installed"}
    for k, v in data.items():
        if k in allowed and hasattr(skill, k):
            setattr(skill, k, v)

    await session.commit()
    await session.refresh(skill)
    return skill.to_dict()


@router.post("/skills/{skill_id}/sync")
async def sync_skill(
    skill_id: int,
    req: AdminSkillSync,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """同步技能（重装/刷新配置）"""
    skill = (await session.execute(
        select(Skill).where(Skill.id == skill_id)
    )).scalar_one_or_none()
    if not skill:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "技能不存在")

    if req.action == "reinstall":
        skill.is_installed = True
        skill.installed_at = datetime.utcnow()
    elif req.action == "refresh":
        # 标记为已安装（刷新配置）
        if skill.source == "builtin":
            skill.is_installed = True
            skill.installed_at = skill.installed_at or datetime.utcnow()

    await session.commit()
    await session.refresh(skill)
    return skill.to_dict()


@router.post("/skills")
async def admin_create_skill(
    data: dict,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """管理员创建技能"""
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "技能名称不能为空")

    existing = (await session.execute(
        select(Skill).where(Skill.name == name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"技能「{name}」已存在")

    skill = Skill(
        name=name,
        description=data.get("description", ""),
        category=data.get("category", "custom"),
        source=data.get("source", "custom"),
        github_url=data.get("github_url", ""),
        version=data.get("version", "1.0"),
        config=data.get("config", {}),
        is_installed=data.get("is_installed", True),
        installed_at=datetime.utcnow() if data.get("is_installed", True) else None,
    )
    session.add(skill)
    await session.commit()
    await session.refresh(skill)
    return skill.to_dict()


@router.delete("/skills/{skill_id}")
async def admin_delete_skill(
    skill_id: int,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """管理员删除技能"""
    skill = (await session.execute(
        select(Skill).where(Skill.id == skill_id)
    )).scalar_one_or_none()
    if not skill:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "技能不存在")

    name = skill.name
    await session.execute(delete(Skill).where(Skill.id == skill_id))
    await session.commit()
    return {"ok": True, "message": f"技能「{name}」已删除"}


@router.post("/skills/batch-sync")
async def batch_sync_skills(
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
):
    """批量同步所有内置技能（标记为 installed）"""
    rows = (await session.execute(
        select(Skill).where(Skill.source == "builtin")
    )).scalars().all()
    count = 0
    for skill in rows:
        if not skill.is_installed:
            skill.is_installed = True
            skill.installed_at = datetime.utcnow()
            count += 1

    await session.commit()
    return {"ok": True, "synced": count, "total": len(rows),
            "message": f"已同步 {count}/{len(rows)} 个内置技能"}
