# -*- coding: utf-8 -*-
"""pytest 共享 fixtures：工具、消息、LLM 配置等"""

from __future__ import annotations
import sys
import os
import pytest
import tempfile

# 确保 src/ 在 sys.path 中
_proj_root = os.path.dirname(os.path.dirname(__file__))
if _proj_root not in sys.path:
    sys.path.insert(0, _proj_root)

from src.tools.base import ToolRegistry, get_registry
from src.core.message import Message, ToolCall, ToolResult
from src.core.llm import LLMConfig


# ============================================================
# 工具系统 fixtures
# ============================================================

@pytest.fixture
def fresh_registry() -> ToolRegistry:
    """每次测试全新注册中心（非全局单例）"""
    return ToolRegistry()


@pytest.fixture
def global_registry() -> ToolRegistry:
    """全局单例注册中心（测试后清空）"""
    reg = get_registry()
    reg._tools.clear()
    return reg


# ============================================================
# 消息系统 fixtures
# ============================================================

@pytest.fixture
def tool_call() -> ToolCall:
    return ToolCall(
        id="call_001",
        name="calculator",
        arguments={"expression": "2 + 2"},
    )


@pytest.fixture
def tool_result() -> ToolResult:
    return ToolResult(
        call_id="call_001",
        name="calculator",
        success=True,
        result="4",
    )


@pytest.fixture
def sample_messages() -> list[Message]:
    return [
        Message.system("你是智能助手"),
        Message.user("计算 2+2"),
        Message.assistant(
            "", 
            [ToolCall(id="c1", name="calculator", arguments={"expression": "2+2"})]
        ),
        Message.tool_result(
            ToolResult(call_id="c1", name="calculator", success=True, result="4")
        ),
    ]


# ============================================================
# LLM 配置 fixtures
# ============================================================

@pytest.fixture
def llm_config_openai() -> LLMConfig:
    return LLMConfig(provider="openai", model="gpt-4o", api_key="sk-test123")


@pytest.fixture
def llm_config_deepseek() -> LLMConfig:
    return LLMConfig(provider="deepseek", model="deepseek-chat", api_key="sk-test456")


@pytest.fixture
def llm_config_custom() -> LLMConfig:
    return LLMConfig(
        provider="custom", model="custom-model",
        api_key="sk-custom", base_url="https://custom.api.com/v1",
    )


# ============================================================
# 临时文件 fixtures
# ============================================================

@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def temp_file(temp_dir):
    path = os.path.join(temp_dir, "test.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("Hello, World!\nThis is a test file.")
    return path
