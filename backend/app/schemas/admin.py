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

    model_config = {
        "json_schema_extra": {
            "example": {"email": "user@example.com", "role": "user", "is_active": True}
        }
    }
