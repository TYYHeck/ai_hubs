# -*- coding: utf-8 -*-
"""API v1 路由"""

from fastapi import APIRouter

from .auth import router as auth_router
from .chat import router as chat_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(chat_router)

__all__ = ["api_router", "auth_router", "chat_router"]
