# -*- coding: utf-8 -*-
"""
Tracing 可观测性 —— LangSmith 自动集成

LangChain 1.x 内置 LangSmith 回调自动检测机制：
  设置 LANGCHAIN_TRACING_V2=true + LANGCHAIN_API_KEY 即可自动追踪所有调用。

  环境变量:
    LANGCHAIN_TRACING_V2=true
    LANGCHAIN_API_KEY=ls__...
    LANGCHAIN_PROJECT=ai_hubs  (可选)

用法:
    from src.core.tracing import init_tracing
    init_tracing(project="ai_hubs")
"""

from __future__ import annotations
import os
import logging

logger = logging.getLogger("ai_hubs.tracing")


def init_tracing(project: str = "ai_hubs", enabled: bool = True):
    """启用 LangSmith tracing"""
    if not enabled:
        return False

    api_key = os.getenv("LANGCHAIN_API_KEY", "")
    if not api_key:
        logger.debug("LangSmith 未配置 (LANGCHAIN_API_KEY 未设置)，tracing 已跳过")
        return False

    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = project

    logger.info(f"LangSmith tracing 已启用，项目: {project}")
    return True


def get_tracing_stats() -> dict:
    """获取 tracing 状态"""
    return {
        "enabled": os.getenv("LANGCHAIN_TRACING_V2") == "true",
        "project": os.getenv("LANGCHAIN_PROJECT", "ai_hubs"),
        "has_api_key": bool(os.getenv("LANGCHAIN_API_KEY")),
    }
