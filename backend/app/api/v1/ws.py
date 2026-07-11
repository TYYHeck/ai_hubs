# -*- coding: utf-8 -*-
"""
WebSocket 端点 — 桌面客户端本地工具代理
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt

from ...config import settings
from ...database import create_session
from ...models.user import User
from ...core.local_proxy import register, unregister, resolve_pending
from sqlalchemy import select

router = APIRouter()
logger = logging.getLogger("ai_hubs.ws")


async def _auth_ws(token: str) -> User | None:
    """WebSocket 鉴权：验证 JWT，返回用户对象"""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id: int = int(payload.get("sub", 0))
        if not user_id:
            return None
        async with create_session() as session:
            return await session.get(User, user_id)
    except (JWTError, Exception):
        return None


@router.websocket("/ws/local-tools")
async def local_tools_ws(
    websocket: WebSocket,
    token: str = Query(..., description="JWT 认证令牌"),
):
    """
    桌面客户端建立此连接后，AI 工具调用将优先路由到本地执行。

    消息格式：
      服务端 → 客户端：{"type":"tool_request","id":"...","tool":"run_code","args":{...}}
      客户端 → 服务端：{"type":"tool_result","id":"...","result":{...}}
      客户端 → 服务端：{"type":"set_root","root":"/abs/path/to/project"}（可选，设置本地根目录）
      客户端 → 服务端：{"type":"ping"}  心跳
    """
    user = await _auth_ws(token)
    if not user:
        await websocket.close(code=4001, reason="认证失败")
        return

    await websocket.accept()
    await register(user.id, websocket)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "tool_result":
                req_id = msg.get("id", "")
                result = msg.get("result", {})
                if not resolve_pending(req_id, result):
                    logger.warning(f"No pending request for id={req_id}")

            elif msg_type == "ping":
                await websocket.send_text('{"type":"pong"}')

            elif msg_type == "set_root":
                # 客户端告知本地项目根目录路径（供日志/调试）
                root = msg.get("root", "")
                logger.info(f"User {user.id} set local root: {root}")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error for user {user.id}: {e}")
    finally:
        unregister(user.id)
