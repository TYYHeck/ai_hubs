# -*- coding: utf-8 -*-
"""Agent 管理 API — CRUD + 列表"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.agent import Agent
from ...schemas.agent import AgentCreate, AgentUpdate
from ..deps import get_current_user

router = APIRouter(prefix="/agents", tags=["Agents"])


@router.get("")
async def list_agents(
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取当前用户的所有 Agent"""
    stmt = select(Agent).where(Agent.user_id == current_user.id).order_by(Agent.updated_at.desc())
    result = await session.execute(stmt)
    agents = result.scalars().all()
    return [a.to_dict() for a in agents]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_agent(
    data: AgentCreate,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """创建新 Agent"""
    agent = Agent(
        user_id=current_user.id,
        name=data.name,
        description=data.description,
        system_prompt=data.system_prompt,
        model=data.model,
        provider=data.provider,
        enable_planning=data.enable_planning,
        enable_rag=data.enable_rag,
        enable_reflection=data.enable_reflection,
        max_iterations=data.max_iterations,
        memory_strength=data.memory_strength,
        setup_mode=data.setup_mode,
        skills=data.skills,
        tags=data.tags,
        category=data.category,
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent.to_dict()


@router.get("/{agent_id}")
async def get_agent(
    agent_id: int,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取单个 Agent 详情"""
    agent = await session.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    return agent.to_dict()


@router.put("/{agent_id}")
async def update_agent(
    agent_id: int,
    data: AgentUpdate,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """更新 Agent 配置"""
    agent = await session.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent 不存在")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(agent, key, value)

    await session.commit()
    await session.refresh(agent)
    return agent.to_dict()


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: int,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除 Agent"""
    agent = await session.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    await session.delete(agent)
    await session.commit()
