# -*- coding: utf-8 -*-
"""后台管理相关 Schema"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AdminUserUpdate(BaseModel):
    """管理员更新用户资料"""
    email: Optional[str] = Field(None, description="邮箱（空字符串表示不修改）")
    role: Optional[str] = Field(None, description="角色: admin | user")
    is_active: Optional[bool] = Field(None, description="是否启用")
    token_quota: Optional[int] = Field(None, description="Token 配额（None 保持默认，0 表示不限）")

    model_config = {
        "json_schema_extra": {
            "example": {"email": "user@example.com", "role": "user", "is_active": True, "token_quota": 50000}
        }
    }


class AdminUserQuotaUpdate(BaseModel):
    """管理员设置用户配额"""
    token_quota: int = Field(..., description="Token 配额（0 表示不限）")

    model_config = {
        "json_schema_extra": {"example": {"token_quota": 50000}}
    }


class AdminAgentCopy(BaseModel):
    """复制 Agent 到指定用户"""
    target_user_id: int = Field(..., description="目标用户 ID")
    new_name: Optional[str] = Field(None, description="新 Agent 名称（留空则保留原名）")

    model_config = {
        "json_schema_extra": {"example": {"target_user_id": 2, "new_name": "我的助手"}}
    }


class AdminSkillSync(BaseModel):
    """同步技能配置"""
    action: str = Field("refresh", description="操作类型: refresh(刷新内置) | reinstall(重装全部)")

    model_config = {
        "json_schema_extra": {"example": {"action": "refresh"}}
    }
