# -*- coding: utf-8 -*-
"""API v1 路由"""

from fastapi import APIRouter

from .auth import router as auth_router
from .chat import router as chat_router
from .agents import router as agents_router
from .tasks import router as tasks_router
from .memory import router as memory_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(chat_router)
api_router.include_router(agents_router)
api_router.include_router(tasks_router)
api_router.include_router(memory_router)

__all__ = ["api_router", "auth_router", "chat_router", "agents_router", "tasks_router", "memory_router"]
