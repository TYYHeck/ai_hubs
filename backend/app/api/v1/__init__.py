# -*- coding: utf-8 -*-
"""API v1 路由"""

from fastapi import APIRouter

from .auth import router as auth_router
from .chat import router as chat_router
from .agents import router as agents_router
from .tasks import router as tasks_router
from .memory import router as memory_router
from .skills import router as skills_router
from .datasets import router as datasets_router
from .ide import router as ide_router
from .admin import router as admin_router
from .uploads import router as uploads_router
from .dashboard import router as dashboard_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(chat_router)
api_router.include_router(agents_router)
api_router.include_router(tasks_router)
api_router.include_router(memory_router)
api_router.include_router(skills_router)
api_router.include_router(datasets_router)
api_router.include_router(ide_router)
api_router.include_router(admin_router)
api_router.include_router(uploads_router)
api_router.include_router(dashboard_router)

__all__ = [
    "api_router", "auth_router", "chat_router", "agents_router", "tasks_router",
    "memory_router", "skills_router", "datasets_router", "ide_router", "admin_router",
    "uploads_router", "dashboard_router",
]
