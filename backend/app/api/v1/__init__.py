# -*- coding: utf-8 -*-
"""API v1 路由"""

from fastapi import APIRouter

from .auth import router as auth_router

api_router = APIRouter()
api_router.include_router(auth_router)

__all__ = ["api_router", "auth_router"]
