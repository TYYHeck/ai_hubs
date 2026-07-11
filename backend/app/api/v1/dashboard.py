# -*- coding: utf-8 -*-
"""仪表盘 API — 用户个人统计数据"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.user import User
from ...models.agent import Agent
from ...models.task import Task
from ...models.dataset import Dataset
from ...models.memory import MemoryEntry
from ..deps import get_current_user

router = APIRouter(prefix="/dashboard", tags=["仪表盘"])


@router.get("")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取当前用户的仪表盘统计数据"""

    user_id = current_user.id

    # Agent 数量
    agents_count = (
        await session.execute(
            select(func.count()).select_from(Agent).where(Agent.user_id == user_id)
        )
    ).scalar() or 0

    # 运行中任务
    running_tasks = (
        await session.execute(
            select(func.count())
            .select_from(Task)
            .where(Task.user_id == user_id, Task.status == "running")
        )
    ).scalar() or 0

    # 记忆条目
    memory_entries = (
        await session.execute(
            select(func.count()).select_from(MemoryEntry).where(
                MemoryEntry.user_id == user_id
            )
        )
    ).scalar() or 0

    # 知识库（数据集）
    datasets_count = (
        await session.execute(
            select(func.count()).select_from(Dataset).where(Dataset.user_id == user_id)
        )
    ).scalar() or 0

    return {
        "agents": agents_count,
        "running_tasks": running_tasks,
        "memory_entries": memory_entries,
        "datasets": datasets_count,
    }
