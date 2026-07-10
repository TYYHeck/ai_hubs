# -*- coding: utf-8 -*-
"""认证路由 — 注册/登录/验证码"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...schemas.auth import (
    SendCodeRequest, RegisterRequest, LoginRequest, TokenResponse,
)
from ...services.auth_service import (
    validate_username, validate_password, validate_email,
    send_verification_code, register_user, authenticate_user,
)
from ..deps import get_current_user
from ...models.user import User

router = APIRouter(prefix="/api/v1/auth", tags=["认证"])


@router.post("/send-code")
async def send_code(req: SendCodeRequest, session: AsyncSession = Depends(get_session)):
    """发送邮箱验证码"""
    if err := validate_email(req.email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err)

    try:
        await send_verification_code(req.email, session)
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"验证码发送失败: {e}")

    return {"ok": True, "message": f"验证码已发送至 {req.email}"}


@router.post("/register")
async def register(req: RegisterRequest, session: AsyncSession = Depends(get_session)):
    """注册新用户"""
    # 密码确认
    if req.password != req.confirm_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "两次密码不一致")

    # 验证
    for validator, value, field in [
        (validate_username, req.username, "用户名"),
        (validate_password, req.password, "密码"),
        (validate_email, req.email, "邮箱"),
    ]:
        if err := validator(value):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{field}: {err}")

    try:
        user = await register_user(
            req.username, req.password, req.email, req.code, session,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    return {"ok": True, "user": user.to_dict(), "message": "注册成功"}


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, session: AsyncSession = Depends(get_session)):
    """登录"""
    try:
        user, token = await authenticate_user(req.username, req.password, session)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=user.to_dict(),
    )


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return {"ok": True, "user": current_user.to_dict()}
