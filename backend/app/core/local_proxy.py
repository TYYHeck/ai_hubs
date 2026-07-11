# -*- coding: utf-8 -*-
"""
本地工具代理 — 桌面客户端 WebSocket 工具调用转发

流程：
  AI 发起工具调用 → execute_tool 检测是否有本地连接
  → 若有：通过 WebSocket 发送 tool_request 给桌面客户端
  → 客户端在本地执行（读写文件/运行代码）
  → 结果通过 WebSocket 返回 → 继续 AI 对话
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("ai_hubs.local_proxy")

# user_id → 活跃的 WebSocket 连接
_connections: dict[int, WebSocket] = {}

# request_id → 等待结果的 Future
_pending: dict[str, asyncio.Future[dict]] = {}


def is_connected(user_id: int) -> bool:
    """检查该用户是否有活跃的本地客户端连接"""
    return user_id in _connections


async def register(user_id: int, ws: WebSocket) -> None:
    """注册桌面客户端连接"""
    old = _connections.get(user_id)
    if old:
        try:
            await old.close()
        except Exception:
            pass
    _connections[user_id] = ws
    logger.info(f"Local client connected for user {user_id}")


def unregister(user_id: int) -> None:
    """注销连接，取消所有挂起请求"""
    _connections.pop(user_id, None)
    # 取消该用户所有挂起的 Future（连接断开，结果永远不会来了）
    to_cancel = [rid for rid, fut in _pending.items()
                 if not fut.done() and getattr(fut, '_user_id', None) == user_id]
    for rid in to_cancel:
        fut = _pending.pop(rid, None)
        if fut and not fut.done():
            fut.cancel()
    logger.info(f"Local client disconnected for user {user_id}")


async def call_local_tool(
    user_id: int,
    tool_name: str,
    tool_args: dict[str, Any],
    timeout: float = 60.0,
) -> dict[str, Any]:
    """
    向桌面客户端发送工具调用请求，等待结果返回。
    超时或连接断开时抛出 RuntimeError。
    """
    ws = _connections.get(user_id)
    if not ws:
        raise RuntimeError(f"没有可用的本地客户端连接（用户 {user_id}）")

    req_id = str(uuid.uuid4())
    loop = asyncio.get_event_loop()
    fut: asyncio.Future[dict] = loop.create_future()
    fut._user_id = user_id  # type: ignore[attr-defined]
    _pending[req_id] = fut

    try:
        await ws.send_text(json.dumps({
            "type": "tool_request",
            "id": req_id,
            "tool": tool_name,
            "args": tool_args,
        }, ensure_ascii=False))
        result = await asyncio.wait_for(fut, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        raise RuntimeError(f"本地工具调用超时（{timeout}s）: {tool_name}")
    finally:
        _pending.pop(req_id, None)


def resolve_pending(req_id: str, result: dict[str, Any]) -> bool:
    """收到客户端返回的工具结果，解析对应的 Future"""
    fut = _pending.get(req_id)
    if fut and not fut.done():
        fut.set_result(result)
        return True
    return False
