# -*- coding: utf-8 -*-
"""
对话路由 — SSE 流式对话 + 对话管理 + LLM 配置

SSE 事件格式:
  data: {"event": "start", "conversation_id": "..."}\n\n
  data: {"event": "delta", "content": "文本片段"}\n\n
  data: {"event": "tool_start", "name": "run_code", "summary": "执行 python..."}\n\n
  data: {"event": "tool_result", "name": "run_code", "result": "..."}\n\n
  data: {"event": "done", "message_id": ..., "conversation_id": "..."}\n\n
  data: {"event": "error", "message": "..."}\n\n
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.user import User
from ...models.conversation import Conversation, Message
from ...schemas.chat import ChatRequest, CreateConversationRequest, LLMConfigRequest
from ..deps import get_current_user
from ...core.llm import llm_manager, get_llm_config, save_llm_config, PROVIDERS
from ...core.memory import _estimate_tokens
from ...core.tools import (
    TOOL_DEFINITIONS, TOOL_SYSTEM_PROMPT, should_enable_tools, execute_tool,
)
from functools import partial
from ...config import DATA_DIR

# 可直接读取注入到消息中的文本文件扩展名
_TEXT_READABLE_EXT = {
    ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
    ".log", ".cfg", ".ini", ".toml", ".sh", ".bat", ".ps1",
    ".c", ".cpp", ".h", ".hpp", ".java", ".go", ".rs", ".rb",
    ".php", ".swift", ".kt", ".r", ".sql", ".graphql", ".proto",
}

_MAX_READ_BYTES = 50 * 1024  # 文本文件最多读取 50KB
_MAX_INJECT_CHARS = 6000     # 注入到消息中的最大字符数

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
# 附件占位符解析
# ============================================================

async def _resolve_attachments(
    message: str,
    attachment_ids: list[int],
    user_id: int,
    session: AsyncSession,
) -> str:
    """将消息中的 [doc#N] / [image#N] / [file#N] 占位符替换为实际文件内容。
    
    文本文件直接读取内容注入；二进制/图片文件注入文件元信息。
    """
    if not attachment_ids:
        return message

    from ...models.attachment import Attachment as AttModel

    result = await session.execute(
        select(AttModel).where(
            AttModel.id.in_(attachment_ids),
            AttModel.user_id == user_id,
        )
    )
    attachments = {a.id: a for a in result.scalars().all()}
    if not attachments:
        return message

    upload_root = DATA_DIR / "uploads"

    def _read_content(att: AttModel) -> str:
        """读取附件内容文本"""
        disk_path = upload_root / att.storage_path
        if not disk_path.exists():
            return f"[文件已丢失: {att.filename}]"

        ext = Path(att.filename).suffix.lower() if att.filename else ""

        # 文本文件：直接读取注入
        if ext in _TEXT_READABLE_EXT:
            try:
                raw = disk_path.read_bytes()
                if len(raw) > _MAX_READ_BYTES:
                    raw = raw[:_MAX_READ_BYTES]
                # 尝试 UTF-8 解码
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError:
                    try:
                        text = raw.decode("gbk")
                    except UnicodeDecodeError:
                        text = raw.decode("latin-1")
                if len(text) > _MAX_INJECT_CHARS:
                    text = text[:_MAX_INJECT_CHARS] + "\n…（文件过长，仅展示前部分内容）"
                return f"\n\n【附件：{att.filename}】\n```{ext.lstrip('.')}\n{text}\n```\n"
            except Exception as e:
                return f"\n\n【附件：{att.filename}】读取失败: {e}\n"

        # 图片文件：告知 LLM 用户上传了图片
        if att.kind == "image":
            return (
                f"\n\n【图片附件：{att.filename}】"
                f"（{att.size / 1024:.1f}KB，格式 {att.mime_type or 'unknown'}）\n"
                f"用户上传了这张图片。你可以根据文件名和上下文推断图片内容。\n"
            )

        # 其他二进制文件（PDF/DOCX/XLSX/PPT 等）：提供元信息
        return (
            f"\n\n【文档附件：{att.filename}】"
            f"（{att.size / 1024:.1f}KB，格式 {att.mime_type or ext}）\n"
            f"用户上传了此文件。若需读取内容，请使用 run_terminal "
            f"调用对应的 Python 库解析（如 PyPDF2、python-docx、openpyxl、python-pptx）。\n"
        )

    # 构建 placeholder → content 的映射
    placeholder_map: dict[str, str] = {}
    for att in attachments.values():
        content = _read_content(att)
        # 匹配 [doc#N]、[image#N]、[file#N]（不区分大小写）
        pattern = re.compile(
            rf"\[{re.escape(att.kind)}#{att.ref_index}\]",
            re.IGNORECASE,
        )
        placeholder_map[pattern] = content

    # 替换消息中的占位符
    resolved = message
    for pattern, content in placeholder_map.items():
        resolved = pattern.sub(content, resolved)
    
    # 清理未匹配的占位符（可能附件 ID 列表和消息占位符不一致）
    return resolved


# ============================================================
# SSE 流式对话
# ============================================================

@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """SSE 流式对话"""

    async def event_stream():
        try:
            # 解析是否使用用户自带 LLM 配置（自带 key 则不受平台 token 配额限制）
            user_llm = current_user.llm_config or {}
            using_own_key = bool(user_llm.get("api_key"))

            # 0. token 配额校验（仅使用平台免费额度时限制；用户自带 key 或管理员不限）
            if not using_own_key:
                quota = current_user.get_token_quota()
                if quota is not None and current_user.get_token_used() >= quota:
                    yield _sse({
                        "event": "error",
                        "message": f"您的对话 token 配额已用尽（上限 {quota}），可在「设置」中填写自己的 API Key 后无限制使用，或联系管理员重置。",
                    })
                    return

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
                # 使用请求指定的 model，否则用全局默认
                active_model = req.model or get_llm_config().get("model", "")
                conv = Conversation(
                    id=conv_id,
                    user_id=current_user.id,
                    title=req.message[:50] if req.message else "新对话",
                    agent_name=req.agent_name,
                    model=active_model,
                )
                session.add(conv)
                await session.flush()
    
            # 2. 保存用户消息
            user_msg = Message(
                conversation_id=conv_id,
                role="user",
                content=req.message,
                tokens_used=_estimate_tokens(req.message),
            )
            session.add(user_msg)
            await session.flush()
    
            # 2.1 绑定附件到对话（若上传时尚未绑定）
            if req.attachment_ids:
                from ...models.attachment import Attachment as AttModel
                result = await session.execute(
                    select(AttModel).where(
                        AttModel.id.in_(req.attachment_ids),
                        AttModel.user_id == current_user.id,
                    )
                )
                for att in result.scalars().all():
                    att.conversation_id = conv_id
    
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
    
            # ── 构建系统级 System Prompt（角色 + 技能清单 + 命令列表）──
            base_prompt = req.system_prompt or ""

            # 若前端未传 system_prompt，根据 agent_name 从数据库查询 Agent 的 system_prompt
            if not base_prompt and req.agent_name:
                from ...models.agent import Agent as AgentModel
                agent_result = await session.execute(
                    select(AgentModel).where(
                        AgentModel.user_id == current_user.id,
                        AgentModel.name == req.agent_name,
                    )
                )
                agent_row = agent_result.scalar_one_or_none()
                if agent_row and agent_row.system_prompt:
                    base_prompt = agent_row.system_prompt

            # 若仍未获取到，使用平台默认 system prompt
            if not base_prompt:
                base_prompt = _build_default_system_prompt(req.skills or [])
    
            # 注入技能上下文
            skill_ctx = ""
            if req.skills:
                from ...models.skill import Skill as SkillModel
                sk_stmt = select(SkillModel).where(
                    SkillModel.name.in_(req.skills),
                    SkillModel.is_installed == True,  # noqa: E712
                )
                skills_rows = (await session.execute(sk_stmt)).scalars().all()
                if skills_rows:
                    # 区分代码类技能 vs 行为类技能
                    code_skills = [sk for sk in skills_rows if (sk.config or {}).get("code")]
                    behavior_skills = [sk for sk in skills_rows if not (sk.config or {}).get("code")]

                    # 行为模式注入：用强指令要求 LLM 真正扮演该角色
                    if behavior_skills:
                        desc_parts = []
                        for sk in behavior_skills:
                            desc_parts.append(f"- **{sk.name}**：{sk.description or '无描述'}")
                        skill_ctx = (
                            "\n\n# 🔴 最高优先级：激活的行为技能\n"
                            "以下技能已激活且必须严格遵守。这不是可选的参考信息，"
                            "而是你必须执行的行为指令。请以该技能定义的身份、"
                            "语气和交互方式来回复，主动引导对话，提问以理解用户需求。\n\n"
                            + "\n".join(desc_parts)
                        )

                    # 代码工具注入：仅对包含代码的技能追加可执行实现
                    if code_skills:
                        if not skill_ctx:
                            skill_ctx = "\n\n# 当前激活的技能\n"
                        code_blocks = []
                        for sk in code_skills:
                            cfg = sk.config or {}
                            code = cfg.get("code") or ""
                            entry = cfg.get("entry") or "skill.py"
                            code_view = (code[:2000] + "…") if len(code) > 2000 else code
                            code_blocks.append(
                                f"【{sk.name}】入口：{entry}\n```\n{code_view}\n```"
                            )
                        skill_ctx += (
                            "\n\n# 技能可执行代码\n以下技能提供了可执行代码，"
                            "请用 run_terminal 在适用场景下调用：\n\n"
                            + "\n\n".join(code_blocks)
                        )
    
            # 组装第一条 system message：基础 prompt + 技能上下文
            full_system = base_prompt
            if skill_ctx:
                full_system += skill_ctx
            messages.append({"role": "system", "content": full_system})
    
            for m in history:
                messages.append({"role": m.role, "content": m.content})
            # 解析附件占位符，替换为实际文件内容
            resolved_message = await _resolve_attachments(
                req.message, req.attachment_ids, current_user.id, session,
            )
            messages.append({"role": "user", "content": resolved_message})
    
            # 3.1 判断是否启用 Agent 工具调用（基于用户选用的技能）
            tools_enabled = should_enable_tools(req.skills or [])
            if tools_enabled:
                # 注入工具系统提示（合并到第一条 system message 或追加）
                if messages and messages[0]["role"] == "system":
                    messages[0]["content"] = messages[0]["content"] + "\n\n" + TOOL_SYSTEM_PROMPT
                else:
                    messages.insert(0, {"role": "system", "content": TOOL_SYSTEM_PROMPT})
    
            # 4. 发送开始事件
            yield _sse({
                "event": "start",
                "conversation_id": conv_id,
                "tools_enabled": tools_enabled,
            })
    
            # 5. 流式调用 LLM
            full_response = []
    
            if tools_enabled:
                # ── 工具调用分支：逐事件产出具象化输出 ──
                llm_config = user_llm if using_own_key else None
                async for event in llm_manager.stream_with_tools(
                    messages=messages,
                    tools=TOOL_DEFINITIONS,
                    tool_executor=partial(execute_tool, session=session),
                    user_id=current_user.id,
                    model=req.model or None,
                    user_config=llm_config,
                ):
                    if await request.is_disconnected():
                        break
    
                    etype = event.get("type", "")
                    if etype == "delta":
                        content = event.get("content", "")
                        full_response.append(content)
                        yield _sse({"event": "delta", "content": content})
                    elif etype == "tool_start":
                        yield _sse({
                            "event": "tool_start",
                            "name": event.get("name", ""),
                            "args": event.get("args", {}),
                            "summary": event.get("summary", ""),
                        })
                    elif etype == "tool_result":
                        yield _sse({
                            "event": "tool_result",
                            "name": event.get("name", ""),
                            "result": event.get("result", ""),
                        })
                        # 工具结果也追加到 full_response（作为对话上下文展示）
                        tool_label = f"\n[工具: {event.get('name', '')}]\n{event.get('result', '')}\n"
                        full_response.append(tool_label)
                    elif etype == "done":
                        break  # 正常结束
            else:
                # ── 无工具分支：纯文本流式（原逻辑）──
                llm_config = user_llm if using_own_key else None
                async for chunk in llm_manager.stream_chat(messages, model=req.model or None, user_config=llm_config):
                    if await request.is_disconnected():
                        break
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
    
            # 累计 token 用量（仅使用平台免费额度时累计；用户自带 key 不计入平台配额）
            if not using_own_key:
                est_tokens = _estimate_tokens(req.message) + _estimate_tokens("".join(full_response))
                current_user.add_token_usage(est_tokens)
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
    """获取当前用户的个人 LLM 配置（API Key 脱敏）。

    注意：这是「每个用户自己」的配置。填写后使用用户自己的额度（不限 token）；
    留空则使用平台全局免费额度（受 token 配额限制）。
    """
    user_cfg = current_user.llm_config or {}
    # 脱敏 API Key
    api_key = user_cfg.get("api_key", "")
    if len(api_key) > 8:
        masked = api_key[:4] + "*" * (len(api_key) - 8) + api_key[-4:]
    else:
        masked = "*" * len(api_key) if api_key else ""

    return {
        "ok": True,
        "scope": "user",
        "config": {
            "provider": user_cfg.get("provider", "deepseek"),
            "model": user_cfg.get("model", ""),
            "api_key": masked,
            "api_key_configured": bool(api_key),
            "base_url": user_cfg.get("base_url", ""),
            "temperature": user_cfg.get("temperature", 0.7),
            "max_tokens": user_cfg.get("max_tokens", 4096),
        },
        # 平台是否可用（全局 key 是否已配置）
        "platform_configured": llm_manager.is_configured(),
    }


@router.post("/llm/config")
async def update_llm_config(
    req: LLMConfigRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """更新当前用户的个人 LLM 配置"""
    if req.provider not in PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"不支持的提供商: {req.provider}")

    preset = PROVIDERS[req.provider]
    base_url = req.base_url or preset["base_url"]

    # 若前端传回脱敏 key（含 *），保留原值
    api_key = req.api_key
    if api_key and "*" in api_key:
        api_key = (current_user.llm_config or {}).get("api_key", "")

    current_user.llm_config = {
        "provider": req.provider,
        "model": req.model,
        "api_key": api_key,
        "base_url": base_url,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
    }
    await session.commit()

    return {"ok": True, "message": "个人 LLM 配置已更新"}


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
# 上下文占用统计
# ============================================================

@router.get("/chat/context-usage")
async def context_usage(
    conversation_id: str | None = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """返回当前对话上下文占用情况（token 估算 / 模型 / 长上下文占比）。"""
    cfg = get_llm_config()
    model = cfg.get("model", "unknown")

    # 上下文窗口（常见模型，缺省 128k）
    CONTEXT_WINDOWS = {
        "deepseek-chat": 64000, "deepseek-reasoner": 64000,
        "gpt-4o": 128000, "gpt-4o-mini": 128000, "gpt-3.5-turbo": 16000,
        "glm-4": 128000, "claude-3-5-sonnet": 200000, "qwen-max": 32768,
    }
    window = CONTEXT_WINDOWS.get(model, 128000)

    used_tokens = 0
    msg_count = 0
    if conversation_id:
        result = await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at)
        )
        msgs = result.scalars().all()
        msg_count = len(msgs)
        for m in msgs:
            used_tokens += _estimate_tokens(m.content or "")

    return {
        "ok": True,
        "model": model,
        "context_window": window,
        "used_tokens": used_tokens,
        "message_count": msg_count,
        "usage_ratio": round(min(1.0, used_tokens / window), 4),
    }


# ============================================================
# 工具函数
# ============================================================

def _sse(data: dict) -> str:
    """格式化 SSE 事件"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ═══════════════════════════════════════════════════════════
# 默认 System Prompt 构建
# ═══════════════════════════════════════════════════════════

_SKILL_COMMANDS: dict[str, list[str]] = {
    "docx":       ["/docx", "/word"],
    "xlsx":       ["/xlsx", "/excel", "/表格"],
    "pdf":        ["/pdf"],
    "ppt":        ["/ppt", "/幻灯片"],
    "web-search": ["/search", "/搜索"],
    "run-python": ["/run", "/python"],
    "run-js":     ["/js", "/node"],
    "run-bash":   ["/bash", "/终端"],
    "coding":     ["/code"],
}


def _build_default_system_prompt(skills: list[str]) -> str:
    """构建包含技能清单、命令列表和使用指令的默认 System Prompt。"""
    lines = [
        "你是 AI集群（AI Hubs）的智能助手。",
        "你具备代码编写、文档生成（Word/Excel/PDF/PPT）、图片读取、",
        "终端操作、网页搜索等多种能力。",
        "",
        "## 身份规则",
        "",
        "1. **绝对不要透露底层模型名称**（如 DeepSeek、OpenAI、GPT、GLM 等），",
        '   永远自称「AI集群助手」或「AI Hubs 助手」。',
        '2. 如果用户问「你是什么模型」，回答「我是 AI集群平台的智能助手，由平台统一调度」。',
        "",
        "## 核心原则",
        "",
        "1. **先理解再执行**：收到用户需求后，先确认意图，再选择合适的方式执行。",
        "2. **交互式对话**：面对需求模糊、方案设计、头脑风暴、架构规划等开放性任务时，",
        "   必须主动提问以澄清需求。不要只是输出模板或框架，",
        "   要用提问引导用户给出关键信息，逐步收敛到具体方案。",
        "   ⚠️ 如果用户说「设计一个XX」「帮我规划XX」「讨论XX方案」，务必先问清楚：",
        "   目标场景、约束条件、偏好技术栈、性能要求等，再给出建议。",
        "3. **优先使用工具**：涉及代码执行、文件操作时，调用对应工具。",
        "4. **分步执行**：复杂任务拆解为子步骤，逐步完成并告知用户进度。",
        "5. **安装依赖**：运行技能代码前，先用 run_terminal 安装所需 Python 包（如 pip install python-docx）。",
        "6. **输出清晰**：结果使用 Markdown 格式，代码块标注语言，表格对齐。",
        "7. **错误自愈**：代码执行失败时，分析 stderr 并修正重试（最多 3 次）。",
        "",
        "## 可用命令",
        "",
        "在对话中输入 `/命令` 可快速触发对应能力：",
    ]

    # 列出所有命令
    for skill_name, cmds in _SKILL_COMMANDS.items():
        lines.append(f"- {', '.join(cmds)} → {skill_name}")

    lines.extend([
        "",
        "## 文件工作区",
        "",
        "你可以通过以下工具操作用户的沙箱工作区：",
        "- `write_file(path, content)` — 写入文件",
        "- `read_file(path)` — 读取文件",
        "- `list_files(path?)` — 查看目录",
        "- `run_code(language, code)` — 执行代码（python/js/bash/c/cpp/java）",
        "- `run_terminal(command)` — 执行终端命令",
        "",
        "## 文档处理指南",
        "",
        "- **Word (.docx)**：用 python-docx 库读写，先 `pip install python-docx`",
        "- **Excel (.xlsx)**：用 openpyxl 库读写，支持公式、图表、样式，先 `pip install openpyxl`",
        "- **PDF**：用 PyPDF2/pdfplumber 读取，reportlab 创建，先 `pip install PyPDF2 pdfplumber reportlab`",
        "- **PPT (.pptx)**：用 python-pptx 库创建/编辑，先 `pip install python-pptx`",
        "- **网页搜索**：用 requests + beautifulsoup4 抓取，先 `pip install requests beautifulsoup4`",
        "",
        "## 交互式提问（<ask> 标签）",
        "",
        "当你需要向用户收集结构化信息时（选项明确、需要用户确认、需要填写参数），",
        "使用 <ask> 标签输出交互式提问表单。用户将看到可视化的选择器/输入框，",
        "填写后答案会自动发回给你。",
        "",
        "支持的问题类型及格式：",
        "",
        "**单选 choice**：",
        "<ask>",
        '{"id":"q1","type":"choice","title":"你希望后端用什么语言？","options":["Python","Go","Java","Node.js"]}',
        "</ask>",
        "",
        "**多选 multiselect**：",
        "<ask>",
        '{"id":"q2","type":"multiselect","title":"需要哪些功能？（可多选）","options":["用户认证","支付","文件上传","实时通知","管理后台"]}',
        "</ask>",
        "",
        "**填空 text**：",
        "<ask>",
        '{"id":"q3","type":"text","title":"项目名称是什么？","placeholder":"如：my-project","default":"my-app"}',
        "</ask>",
        "",
        "**确认 confirm**：",
        "<ask>",
        '{"id":"q4","type":"confirm","title":"确认开始部署到生产环境吗？","yes":"立即部署","no":"再检查一下"}',
        "</ask>",
        "",
        "使用规则：",
        "1. 每次最多输出 4 个问题",
        "2. id 必须唯一（q1、q2、q3、q4）",
        "3. choice/multiselect 的 options 数组不超过 6 个选项",
        "4. <ask> 标签放在消息末尾，前面可以先解释为什么要问这些问题",
        "5. 仅在需要用户做结构化选择时使用，不要滥用",
        "6. 简单是非问题可直接文字询问，不需要 <ask>",
        "",
        "## 回复策略",
        "",
        "根据任务类型选择回复模式：",
        "",
        "**模式 A — 执行类任务**（代码编写、文档生成、数据处理）：",
        "1. 简短确认意图",
        "2. 执行操作",
        "3. 展示结果并解释",
        "",
        "**模式 B — 设计/咨询类任务**（方案设计、技术选型、架构规划、需求分析）：",
        "1. 复述你的理解，确认方向正确",
        "2. **提 2-3 个关键问题**收集缺失信息（不要跳过这一步）",
        "   - 如果问题有明确的选项范围，使用 <ask> 标签输出交互式选择",
        "   - 开放式问题可直接用文字询问",
        "3. 根据回答给出具体建议和方案",
        "4. 询问是否需要进一步细化",
    ])

    # 如果用户选中了特定技能，追加针对性提示
    if skills:
        names = [s.lower().strip() for s in skills]
        lines.append("\n## 当前激活的技能")
        for s in skills:
            lines.append(f"- **{s}**")
        lines.append("\n你必须优先使用这些技能的能力来解决问题。")
        if any(n in names for n in ("docx", "xlsx", "pdf", "ppt", "web-search")):
            lines.append("你可以在沙箱中运行这些技能的参考实现代码。请先用 run_terminal 安装对应依赖。")
        if any(n in names for n in ("run-python", "run-js", "run-bash", "coding", "code-runner")):
            lines.append("代码执行工具已启用，可直接编写和运行代码。")
        # 设计/头脑风暴类技能：强调交互性
        if any(n in names for n in ("coding",)):
            lines.append("收到方案设计或架构规划请求时，请先提问澄清需求再给出建议，不要只输出空模板。")

    return "\n".join(lines)
