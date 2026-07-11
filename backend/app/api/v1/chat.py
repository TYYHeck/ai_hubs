# -*- coding: utf-8 -*-
"""
对话路由 — SSE 流式对话 + 对话管理 + LLM 配置

SSE 事件格式:
  data: {"event": "start", "conversation_id": "..."}\n\n
  data: {"event": "delta", "content": "文本片段"}\n\n
  data: {"event": "done", "message_id": ..., "conversation_id": "..."}\n\n
  data: {"event": "error", "message": "..."}\n\n
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.user import User
from ...models.conversation import Conversation, Message
from ...schemas.chat import ChatRequest, CreateConversationRequest, LLMConfigRequest
from ..deps import get_current_user
from ...core.llm import llm_manager, get_llm_config, save_llm_config, PROVIDERS

router = APIRouter(prefix="", tags=["对话"])


# ============================================================
# 对话管理
# ============================================================

@router.get("/conversations")
async def list_conversations(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取对话列表"""
    result = await session.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
    )
    convs = result.scalars().all()
    return {"ok": True, "conversations": [c.to_dict() for c in convs]}


@router.post("/conversations")
async def create_conversation(
    req: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """创建新对话"""
    conv = Conversation(
        id=uuid.uuid4().hex[:32],
        user_id=current_user.id,
        title=req.title,
        agent_name=req.agent_name,
        model=get_llm_config().get("model", ""),
    )
    session.add(conv)
    await session.flush()
    return {"ok": True, "conversation": conv.to_dict()}


@router.delete("/conversations/{conv_id}")
async def delete_conversation(
    conv_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除对话"""
    result = await session.execute(
        select(Conversation).where(
            Conversation.id == conv_id,
            Conversation.user_id == current_user.id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "对话不存在")

    await session.execute(delete(Conversation).where(Conversation.id == conv_id))
    return {"ok": True}


@router.get("/conversations/{conv_id}/messages")
async def get_messages(
    conv_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取对话消息历史"""
    result = await session.execute(
        select(Conversation).where(
            Conversation.id == conv_id,
            Conversation.user_id == current_user.id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "对话不存在")

    result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at)
    )
    messages = result.scalars().all()
    return {"ok": True, "messages": [m.to_dict() for m in messages]}


# ============================================================
# SSE 流式对话
# ============================================================

@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """SSE 流式对话"""

    async def event_stream():
        try:
            # 1. 获取或创建对话
            conv_id = req.conversation_id
            if conv_id:
                result = await session.execute(
                    select(Conversation).where(
                        Conversation.id == conv_id,
                        Conversation.user_id == current_user.id,
                    )
                )
                conv = result.scalar_one_or_none()
                if not conv:
                    yield _sse({"event": "error", "message": "对话不存在"})
                    return
            else:
                conv_id = uuid.uuid4().hex[:32]
                conv = Conversation(
                    id=conv_id,
                    user_id=current_user.id,
                    title=req.message[:50] if req.message else "新对话",
                    agent_name=req.agent_name,
                    model=get_llm_config().get("model", ""),
                )
                session.add(conv)
                await session.flush()

            # 2. 保存用户消息
            user_msg = Message(
                conversation_id=conv_id,
                role="user",
                content=req.message,
            )
            session.add(user_msg)
            await session.flush()

            # 3. 构建消息列表
            # 加载历史消息（最近 20 条）
            result = await session.execute(
                select(Message)
                .where(Message.conversation_id == conv_id)
                .order_by(Message.created_at.desc())
                .limit(21)
            )
            history = list(reversed(result.scalars().all()))
            # 排除刚插入的用户消息（避免重复）
            history = [m for m in history if m.id != user_msg.id]

            messages = []
            if req.system_prompt:
                messages.append({"role": "system", "content": req.system_prompt})
            for m in history:
                messages.append({"role": m.role, "content": m.content})
            messages.append({"role": "user", "content": req.message})

            # 4. 发送开始事件
            yield _sse({"event": "start", "conversation_id": conv_id})

            # 5. 流式调用 LLM
            full_response = []
            async for chunk in llm_manager.stream_chat(messages):
                full_response.append(chunk)
                yield _sse({"event": "delta", "content": chunk})

            # 6. 保存 AI 回复
            ai_msg = Message(
                conversation_id=conv_id,
                role="assistant",
                content="".join(full_response),
                agent_name=req.agent_name,
            )
            session.add(ai_msg)

            # 更新对话时间
            conv.updated_at = datetime.now(timezone.utc)
            await session.flush()

            # 7. 发送完成事件
            yield _sse({
                "event": "done",
                "message_id": ai_msg.id,
                "conversation_id": conv_id,
            })

        except Exception as e:
            yield _sse({"event": "error", "message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx 不缓冲
        },
    )


# ============================================================
# LLM 配置
# ============================================================

@router.get("/llm/config")
async def get_llm_config_api(
    current_user: User = Depends(get_current_user),
):
    """获取当前 LLM 配置（API Key 脱敏）"""
    config = get_llm_config()
    # 脱敏 API Key
    api_key = config.get("api_key", "")
    if len(api_key) > 8:
        masked = api_key[:4] + "*" * (len(api_key) - 8) + api_key[-4:]
    else:
        masked = "*" * len(api_key) if api_key else ""

    return {
        "ok": True,
        "config": {
            "provider": config["provider"],
            "model": config["model"],
            "api_key": masked,
            "api_key_configured": bool(api_key),
            "base_url": config["base_url"],
            "temperature": config["temperature"],
            "max_tokens": config["max_tokens"],
        },
        "is_configured": llm_manager.is_configured(),
    }


@router.post("/llm/config")
async def update_llm_config(
    req: LLMConfigRequest,
    current_user: User = Depends(get_current_user),
):
    """更新 LLM 配置"""
    if req.provider not in PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"不支持的提供商: {req.provider}")

    preset = PROVIDERS[req.provider]
    base_url = req.base_url or preset["base_url"]

    save_llm_config({
        "provider": req.provider,
        "model": req.model,
        "api_key": req.api_key,
        "base_url": base_url,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
    })

    return {"ok": True, "message": "LLM 配置已更新"}


@router.get("/llm/providers")
async def list_providers(
    current_user: User = Depends(get_current_user),
):
    """获取支持的 LLM 提供商列表"""
    return {
        "ok": True,
        "providers": {
            key: {"name": v["name"], "base_url": v["base_url"], "models": v["models"]}
            for key, v in PROVIDERS.items()
        },
    }


# ============================================================
# 工具函数
# ============================================================

def _sse(data: dict) -> str:
    """格式化 SSE 事件"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
