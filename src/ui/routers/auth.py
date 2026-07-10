# -*- coding: utf-8 -*-
"""认证路由 —— 登录 / 注册（邮箱验证码） / 用户信息"""

from __future__ import annotations
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
import re

from src.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["认证"])


# ============================================================
# 输入验证
# ============================================================

def validate_username(v: str) -> str:
    """用户名验证：2-32字符，字母数字下划线中文"""
    v = v.strip()
    if not v or len(v) < 2:
        raise ValueError("用户名至少 2 个字符")
    if len(v) > 32:
        raise ValueError("用户名最长 32 个字符")
    if not re.match(r'^[\w\u4e00-\u9fff]+$', v):
        raise ValueError("用户名只能包含字母、数字、下划线、中文")
    return v


def validate_password(v: str) -> str:
    """密码验证：8-64字符，必须包含字母和数字"""
    if not v or len(v) < 8:
        raise ValueError("密码至少 8 个字符")
    if len(v) > 64:
        raise ValueError("密码最长 64 个字符")
    if not re.search(r'[a-zA-Z]', v):
        raise ValueError("密码必须包含字母")
    if not re.search(r'\d', v):
        raise ValueError("密码必须包含数字")
    return v


def validate_email(v: str) -> str:
    """邮箱验证"""
    v = v.strip()
    if not v:
        raise ValueError("邮箱不能为空")
    if len(v) > 128:
        raise ValueError("邮箱最长 128 个字符")
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', v):
        raise ValueError("邮箱格式不正确")
    return v


def validate_code(v: str) -> str:
    """验证码验证：6位数字"""
    v = v.strip()
    if not re.match(r'^\d{6}$', v):
        raise ValueError("验证码为 6 位数字")
    return v


# ============================================================
# 请求模型
# ============================================================

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32, description="用户名")
    password: str = Field(..., min_length=4, description="密码")

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) < 2:
            raise ValueError("用户名至少 2 个字符")
        if len(v) > 32:
            raise ValueError("用户名最长 32 个字符")
        return v

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        if not v or len(v) < 4:
            raise ValueError("密码不能为空")
        return v


class SendCodeRequest(BaseModel):
    email: str = Field(..., description="接收验证码的邮箱")

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32, description="用户名")
    password: str = Field(..., min_length=8, max_length=64, description="密码")
    confirm_password: str = Field(..., min_length=8, max_length=64, description="确认密码")
    email: str = Field(..., description="邮箱")
    code: str = Field(..., min_length=6, max_length=6, description="邮箱验证码")

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        return validate_username(v)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_password(v)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("code")
    @classmethod
    def check_code(cls, v: str) -> str:
        return validate_code(v)

    @field_validator("confirm_password")
    @classmethod
    def check_confirm(cls, v: str, info) -> str:
        if "password" in info.data and v != info.data["password"]:
            raise ValueError("两次输入的密码不一致")
        return v


# ============================================================
# 路由
# ============================================================

@router.post("/send-code")
async def api_send_code(req: SendCodeRequest):
    """发送邮箱验证码"""
    from ..infrastructure.email_service import (
        generate_code, send_verification_email, store_verification_code, can_send_code,
    )

    email = req.email.strip().lower()

    # 冷却检查
    if not can_send_code(email):
        return JSONResponse(
            {"ok": False, "error": "请 60 秒后再试"},
            status_code=429,
        )

    # 生成并存储验证码
    code = generate_code(6)
    store_verification_code(email, code, ttl_minutes=10)

    # 发送邮件
    success = send_verification_email(email, code)
    if not success:
        return JSONResponse(
            {"ok": False, "error": "验证码发送失败，请检查邮箱地址或稍后重试"},
            status_code=500,
        )

    return {"ok": True, "message": f"验证码已发送至 {email}，有效期 10 分钟"}


@router.post("/login")
async def api_login(req: LoginRequest):
    """用户登录 —— 返回 JWT Token"""
    from src.auth import verify_password, create_access_token
    from src.infrastructure.models import UserModel
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession
    from src.infrastructure.database import get_session

    try:
        async for session in get_session():
            result = await session.execute(
                select(UserModel).where(UserModel.username == req.username)
            )
            user = result.scalar_one_or_none()

            if user is None or not verify_password(req.password, user.password_hash):
                return JSONResponse(
                    {"ok": False, "error": "用户名或密码错误"},
                    status_code=401,
                )

            if not user.is_active:
                return JSONResponse(
                    {"ok": False, "error": "账号已被禁用"},
                    status_code=403,
                )

            # 更新最后登录时间
            from datetime import datetime
            user.last_login_at = datetime.utcnow()
            await session.commit()

            token = create_access_token(data={
                "sub": user.username,
                "role": user.role,
                "uid": user.id,
            })
            return {
                "ok": True,
                "access_token": token,
                "token_type": "bearer",
                "user": user.to_dict(),
            }
    except ImportError:
        return JSONResponse(
            {"ok": False, "error": "认证系统未启用（数据库未连接）"},
            status_code=503,
        )


@router.post("/register")
async def api_register(req: RegisterRequest):
    """用户注册（需邮箱验证码）"""
    from src.auth import hash_password
    from src.infrastructure.models import UserModel
    from sqlalchemy import select
    from src.infrastructure.database import get_session
    from ..infrastructure.email_service import verify_code

    email = req.email.strip().lower()

    # 验证邮箱验证码
    if not verify_code(email, req.code.strip()):
        return JSONResponse(
            {"ok": False, "error": "验证码错误或已过期"},
            status_code=400,
        )

    # 确认密码一致
    if req.password != req.confirm_password:
        return JSONResponse(
            {"ok": False, "error": "两次输入的密码不一致"},
            status_code=400,
        )

    try:
        async for session in get_session():
            # 检查用户名
            result = await session.execute(
                select(UserModel).where(UserModel.username == req.username)
            )
            if result.scalar_one_or_none() is not None:
                return JSONResponse(
                    {"ok": False, "error": "用户名已存在"},
                    status_code=409,
                )

            # 检查邮箱是否已注册
            result = await session.execute(
                select(UserModel).where(UserModel.email == email)
            )
            if result.scalar_one_or_none() is not None:
                return JSONResponse(
                    {"ok": False, "error": "该邮箱已被注册"},
                    status_code=409,
                )

            hashed = hash_password(req.password)
            user = UserModel(
                username=req.username,
                password_hash=hashed,
                email=email,
                role="user",
            )
            session.add(user)
            await session.commit()

            return {
                "ok": True,
                "user": user.to_dict(),
                "message": "注册成功！",
            }
    except ImportError:
        return JSONResponse(
            {"ok": False, "error": "注册功能需要数据库支持"},
            status_code=503,
        )


@router.get("/me")
async def api_me(current_user=Depends(get_current_user)):
    """获取当前用户信息（需要 Bearer Token）"""
    return {"ok": True, "user": current_user.to_dict()}
