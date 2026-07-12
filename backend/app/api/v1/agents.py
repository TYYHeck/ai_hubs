# -*- coding: utf-8 -*-
"""Agent 管理 API — CRUD + 列表"""

import logging
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("ai_hubs.agents")

# Agent 名保留字：与记忆隔离键/系统语义冲突，禁止作为 Agent 名（不区分大小写）。
# 防止普通 Agent 命名为 "default"/"global" 导致记忆与 global/默认记忆键混写。
_RESERVED_AGENT_NAMES = {"default", "global", "__global__", "system", "user"}

from ...core.llm import llm_manager
from ...database import get_session
from ...models.agent import Agent
from ...schemas.agent import (
    AgentCreate, AgentUpdate, AgentAnalyzeRequest, AgentAnalyzeResponse,
)
from ..deps import get_current_user

router = APIRouter(prefix="/agents", tags=["Agents"])


async def _generate_prompt(name: str, description: str, model: str) -> str:
    """快速配置：根据 Agent 名称与描述，调用 AI 生成专业的 system_prompt"""
    prompt = (
        "你是一个资深的 AI Agent 提示词工程师。请根据以下信息，"
        "为这个 Agent 撰写一段专业、清晰、可直接作为 system prompt 的中文指令。\n\n"
        f"Agent 名称：{name}\n"
        f"Agent 描述：{description or '（未提供详细描述）'}\n\n"
        "要求：\n"
        "1. 明确该 Agent 的角色定位与核心职责；\n"
        "2. 说明其专业能力、工作方法与输出规范；\n"
        "3. 语气专业、简洁，避免冗余说明；\n"
        "4. 直接输出提示词正文，不要使用 Markdown 标题或多余包装。"
    )
    try:
        return await llm_manager.chat(
            [{"role": "system", "content": "你是提示词工程师，只输出提示词正文。"},
             {"role": "user", "content": prompt}],
            model=model,
        )
    except Exception as e:
        # AI 生成失败时使用兜底模板，保证创建始终成功
        logger.warning(f"快速配置 AI 生成提示词失败，使用模板兜底: {e}")
        return f"你是一个名为「{name}」的专业 AI 助手。{description}。请以专业、严谨的方式完成任务。"


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


@router.post("/analyze", response_model=AgentAnalyzeResponse)
async def analyze_agent(
    data: AgentAnalyzeRequest,
    current_user=Depends(get_current_user),
):
    """快速配置：根据 Agent 名称与描述，由 AI 分析并推荐技能、标签、分类，
    并生成一份专业的 system prompt 草稿（前端预填到隐藏的 prompt 填写界面）。"""
    skills_block = ""
    if data.available_skills:
        skills_block = (
            "\n\n可用技能列表（只能从中挑选，不要编造）：\n"
            + "\n".join(f"- {s}" for s in data.available_skills)
        )

    prompt = (
        "你是一个资深的 AI Agent 配置顾问。请根据以下信息，"
        "给出该 Agent 的最优配置建议，并以严格的 JSON 格式输出（不要任何多余文字或 Markdown 标记）。\n\n"
        f"Agent 名称：{data.name}\n"
        f"Agent 描述：{data.description or '（未提供详细描述）'}\n"
        f"{skills_block}\n\n"
        "请输出如下 JSON 结构：\n"
        "{\n"
        '  "suggested_skills": ["从可用技能中挑选的相关技能名，无则空数组"],\n'
        '  "suggested_tags": ["3-5 个描述该 Agent 用途的标签"],\n'
        '  "category": "general 或 coding 或 writing 或 research 或 analysis 或 other",\n'
        '  "system_prompt_draft": "为该 Agent 撰写的专业、清晰、可直接作为 system prompt 的中文指令正文（不要使用 Markdown 标题或多余包装）"\n'
        "}"
    )
    try:
        raw = await llm_manager.chat(
            [{"role": "system", "content": "你是 Agent 配置顾问，只输出 JSON。"},
             {"role": "user", "content": prompt}],
            model=data.name and "deepseek-chat",
        )
        # 解析 JSON（容错：去掉 ```json 包裹）
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw[raw.find("{") : raw.rfind("}") + 1] if "{" in raw else raw
        parsed = json.loads(raw)
        return AgentAnalyzeResponse(
            ok=True,
            suggested_skills=parsed.get("suggested_skills", []) or [],
            suggested_tags=parsed.get("suggested_tags", []) or [],
            category=parsed.get("category", "general") or "general",
            system_prompt_draft=parsed.get("system_prompt_draft", "") or "",
        )
    except Exception as e:
        logger.warning(f"快速配置 AI 分析失败，使用模板兜底: {e}")
        # 兜底：基于描述生成一个简单 prompt，不推荐技能
        draft = f"你是一个名为「{data.name}」的专业 AI 助手。{data.description}。请以专业、严谨的方式完成任务。"
        return AgentAnalyzeResponse(ok=True, suggested_skills=[], suggested_tags=[], category="general", system_prompt_draft=draft)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_agent(
    data: AgentCreate,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """创建新 Agent"""
    # 防重复：同用户下不允许同名 Agent（名称不区分大小写）
    exists = (await session.execute(
        select(Agent).where(
            Agent.user_id == current_user.id,
            Agent.name == data.name,
        )
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"名为「{data.name}」的 Agent 已存在，请勿重复创建。",
        )

    # 保留名校验：禁止与记忆隔离键/系统语义冲突的 Agent 名，防记忆混写
    if data.name.strip().lower() in _RESERVED_AGENT_NAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Agent 名称「{data.name}」为系统保留字，请换一个名称。",
        )

    system_prompt = data.system_prompt
    # 快速配置：仅输入名称与描述，由 AI 自动生成专业 system_prompt
    if data.setup_mode == "quick" and not system_prompt:
        system_prompt = await _generate_prompt(data.name, data.description, data.model)

    # 全局默认互斥：若设为默认，则将该用户其他 Agent 的 is_default 置否
    if data.is_default:
        await session.execute(
            Agent.__table__.update()
            .where(Agent.user_id == current_user.id)
            .values(is_default=False)
        )

    agent = Agent(
        user_id=current_user.id,
        name=data.name,
        description=data.description,
        system_prompt=system_prompt,
        model=data.model,
        provider=data.provider,
        config_mode=data.config_mode or "global",
        is_default=bool(data.is_default),
        enable_planning=data.enable_planning,
        enable_rag=data.enable_rag,
        enable_reflection=data.enable_reflection,
        max_iterations=data.max_iterations,
        memory_strength=data.memory_strength,
        setup_mode=data.setup_mode,
        skills=data.skills,
        tags=data.tags,
        category=data.category,
        status="active",
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

    # 保留名校验：若改名，禁止改为系统保留字，防记忆混写
    new_name = update_data.get("name")
    if new_name is not None and new_name.strip().lower() in _RESERVED_AGENT_NAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Agent 名称「{new_name}」为系统保留字，请换一个名称。",
        )

    # 全局默认互斥：若设为默认，则将该用户其他 Agent 的 is_default 置否
    if update_data.get("is_default") is True and not agent.is_default:
        await session.execute(
            Agent.__table__.update()
            .where(Agent.user_id == current_user.id, Agent.id != agent.id)
            .values(is_default=False)
        )

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
