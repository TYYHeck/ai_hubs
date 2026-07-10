# -*- coding: utf-8 -*-
"""后台管理路由 —— 用户管理、平台统计（需 admin 权限）"""

from __future__ import annotations
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import logging

from src.auth.dependencies import get_current_admin
from src.auth import hash_password
from src.infrastructure.database import get_session
from src.infrastructure.models import UserModel
from sqlalchemy import select, func

logger = logging.getLogger("ai_hubs.admin")

router = APIRouter(prefix="/api/admin", tags=["后台管理"])


# ============================================================
# 请求模型
# ============================================================

class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32, description="用户名")
    password: str = Field(..., min_length=8, max_length=64, description="密码")
    email: str = Field("", description="邮箱（可选）")
    role: str = Field("user", description="角色: user / admin")


class UpdateUserRequest(BaseModel):
    role: str | None = Field(None, description="角色")
    is_active: bool | None = Field(None, description="是否启用")
    password: str | None = Field(None, min_length=8, max_length=64, description="重置密码")


# ============================================================
# 辅助
# ============================================================

def _user_to_dict(u: UserModel) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "email": getattr(u, "email", "") or "",
        "role": u.role,
        "is_active": bool(u.is_active),
        "created_at": u.created_at.isoformat() if getattr(u, "created_at", None) else None,
        "last_login_at": u.last_login_at.isoformat() if getattr(u, "last_login_at", None) else None,
        "task_count": getattr(u, "task_count", 0) or 0,
    }


# ============================================================
# 路由
# ============================================================

@router.get("/stats")
async def api_admin_stats(admin=Depends(get_current_admin)):
    """平台统计概览"""
    stats: dict = {
        "users": 0, "agents": 0, "tasks": 0, "datasets": 0,
        "skills": 0, "memory": 0,
    }
    try:
        async for session in get_session():
            stats["users"] = (await session.execute(select(func.count(UserModel.id)))).scalar() or 0

        # Agent 数（内存中）
        from src.core.task_manager import get_task_manager
        tm = get_task_manager()
        stats["agents"] = len(getattr(tm, "_agents", {}) or {})
        stats["tasks"] = len(getattr(tm, "_tasks", {}) or {})

        # 数据集数
        try:
            from src.datasets import get_dataset_manager
            stats["datasets"] = len(get_dataset_manager().list_all())
        except Exception:
            stats["datasets"] = 0

        # 技能数
        try:
            from src.skills.skill_manager import get_skill_manager
            stats["skills"] = len(get_skill_manager().list_all())
        except Exception:
            stats["skills"] = 0
    except Exception as e:
        logger.warning(f"统计信息部分获取失败: {e}")

    return {"ok": True, "stats": stats}


@router.get("/users")
async def api_list_users(admin=Depends(get_current_admin)):
    """列出所有用户（admin 可见）"""
    try:
        async for session in get_session():
            result = await session.execute(select(UserModel).order_by(UserModel.id))
            users = result.scalars().all()
            return {"ok": True, "users": [_user_to_dict(u) for u in users]}
    except ImportError:
        return JSONResponse({"ok": False, "error": "数据库未启用"}, status_code=503)
    except Exception as e:
        logger.error(f"获取用户列表失败: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/users")
async def api_create_user(req: CreateUserRequest, admin=Depends(get_current_admin)):
    """创建用户（管理员）"""
    import re
    if not re.match(r'^[\w\u4e00-\u9fff]{2,32}$', req.username.strip()):
        return JSONResponse({"ok": False, "error": "用户名需 2-32 位字母数字下划线中文"}, status_code=400)
    if not re.search(r'[a-zA-Z]', req.password) or not re.search(r'\d', req.password):
        return JSONResponse({"ok": False, "error": "密码需包含字母和数字"}, status_code=400)

    try:
        async for session in get_session():
            existing = await session.execute(
                select(UserModel).where(UserModel.username == req.username.strip())
            )
            if existing.scalar_one_or_none():
                return JSONResponse({"ok": False, "error": "用户名已存在"}, status_code=409)

            user = UserModel(
                username=req.username.strip(),
                password_hash=hash_password(req.password),
                email=(req.email or "").strip().lower(),
                role=req.role if req.role in ("user", "admin") else "user",
            )
            session.add(user)
            await session.commit()
            return {"ok": True, "user": _user_to_dict(user)}
    except ImportError:
        return JSONResponse({"ok": False, "error": "数据库未启用"}, status_code=503)
    except Exception as e:
        logger.error(f"创建用户失败: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.put("/users/{username}")
async def api_update_user(username: str, req: UpdateUserRequest, admin=Depends(get_current_admin)):
    """更新用户（角色/启用状态/密码）"""
    try:
        async for session in get_session():
            result = await session.execute(
                select(UserModel).where(UserModel.username == username)
            )
            user = result.scalar_one_or_none()
            if user is None:
                return JSONResponse({"ok": False, "error": "用户不存在"}, status_code=404)

            if req.role is not None:
                if req.role not in ("user", "admin"):
                    return JSONResponse({"ok": False, "error": "角色无效"}, status_code=400)
                # 防止管理员把自己降级为普通用户导致锁死
                if user.role == "admin" and req.role != "admin" and admin.username == username:
                    return JSONResponse({"ok": False, "error": "不能降级当前管理员账号"}, status_code=400)
                user.role = req.role
            if req.is_active is not None:
                user.is_active = req.is_active
            if req.password:
                user.password_hash = hash_password(req.password)

            await session.commit()
            return {"ok": True, "user": _user_to_dict(user)}
    except Exception as e:
        logger.error(f"更新用户失败: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.delete("/users/{username}")
async def api_delete_user(username: str, admin=Depends(get_current_admin)):
    """删除用户"""
    if admin.username == username:
        return JSONResponse({"ok": False, "error": "不能删除当前登录的管理员账号"}, status_code=400)
    try:
        async for session in get_session():
            result = await session.execute(
                select(UserModel).where(UserModel.username == username)
            )
            user = result.scalar_one_or_none()
            if user is None:
                return JSONResponse({"ok": False, "error": "用户不存在"}, status_code=404)
            if user.role == "admin":
                return JSONResponse({"ok": False, "error": "不能删除管理员账号"}, status_code=400)
            await session.delete(user)
            await session.commit()
            return {"ok": True}
    except Exception as e:
        logger.error(f"删除用户失败: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
