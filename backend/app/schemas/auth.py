# -*- coding: utf-8 -*-
"""认证 Pydantic 模型"""

from __future__ import annotations
from pydantic import BaseModel, Field


class SendCodeRequest(BaseModel):
    email: str = Field(..., description="邮箱地址")


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8, max_length=64)
    confirm_password: str = Field(..., min_length=8, max_length=64)
    email: str = Field(...)
    code: str = Field(..., min_length=4, max_length=8)


class LoginRequest(BaseModel):
    username: str = Field(...)
    password: str = Field(...)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
