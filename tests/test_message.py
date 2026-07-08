# -*- coding: utf-8 -*-
"""消息系统单元测试 —— 覆盖 Message / ToolCall / ToolResult 全部行为"""

from __future__ import annotations
import pytest
import json
from src.core.message import Message, ToolCall, ToolResult, Role


# ============================================================
# ToolCall 测试
# ============================================================

class TestToolCall:
    def test_create(self):
        tc = ToolCall(id="abc", name="search", arguments={"q": "test"})
        assert tc.id == "abc"
        assert tc.name == "search"
        assert tc.arguments == {"q": "test"}
        assert tc.call_time is not None

    def test_defaults(self):
        tc = ToolCall(id="1", name="run", arguments={})
        assert tc.arguments == {}


# ============================================================
# ToolResult 测试
# ============================================================

class TestToolResult:
    def test_success(self):
        tr = ToolResult(call_id="c1", name="calc", success=True, result=42)
        assert tr.call_id == "c1"
        assert tr.success is True
        assert tr.result == 42
        assert tr.error is None

    def test_failure(self):
        tr = ToolResult(call_id="c2", name="calc", success=False, error="除以零")
        assert tr.success is False
        assert tr.error == "除以零"
        assert tr.result is None


# ============================================================
# Message 工厂方法
# ============================================================

class TestMessageFactory:
    def test_system(self):
        m = Message.system("你是助手")
        assert m.role == "system"
        assert m.content == "你是助手"
        assert m.tool_calls == []
        assert m.tool_call_id is None

    def test_user(self):
        m = Message.user("你好")
        assert m.role == "user"
        assert m.content == "你好"

    def test_assistant_no_tools(self):
        m = Message.assistant("这是回复")
        assert m.role == "assistant"
        assert m.content == "这是回复"
        assert m.tool_calls == []

    def test_assistant_with_tools(self, tool_call):
        m = Message.assistant("", [tool_call])
        assert m.role == "assistant"
        assert len(m.tool_calls) == 1
        assert m.tool_calls[0].name == "calculator"

    def test_tool_result_success(self, tool_result):
        m = Message.tool_result(tool_result)
        assert m.role == "tool"
        assert m.content == "4"
        assert m.tool_call_id == "call_001"

    def test_tool_result_failure(self):
        tr = ToolResult(call_id="err1", name="bad", success=False, error="炸了")
        m = Message.tool_result(tr)
        assert m.role == "tool"
        assert "Error" in m.content


# ============================================================
# Message 序列化 to_dict → OpenAI 兼容
# ============================================================

class TestMessageToDict:
    def test_system_to_dict(self):
        d = Message.system("指令").to_dict()
        assert d == {"role": "system", "content": "指令"}

    def test_user_to_dict(self):
        d = Message.user("问").to_dict()
        assert d == {"role": "user", "content": "问"}

    def test_assistant_to_dict(self):
        d = Message.assistant("回答").to_dict()
        assert d == {"role": "assistant", "content": "回答"}

    def test_assistant_with_tool_calls_to_dict(self, tool_call):
        m = Message.assistant("", [tool_call])
        d = m.to_dict()
        assert d["role"] == "assistant"
        assert "tool_calls" in d
        assert len(d["tool_calls"]) == 1
        tc = d["tool_calls"][0]
        assert tc["type"] == "function"
        assert tc["function"]["name"] == "calculator"
        assert json.loads(tc["function"]["arguments"]) == {"expression": "2 + 2"}

    def test_tool_to_dict(self, tool_result):
        m = Message.tool_result(tool_result)
        d = m.to_dict()
        assert d["role"] == "tool"
        assert d["tool_call_id"] == "call_001"

    def test_to_llm_format_same_as_to_dict(self):
        m = Message.user("test")
        assert m.to_llm_format() == m.to_dict()


# ============================================================
# Message LangChain 互转
# ============================================================

class TestMessageLangChain:
    def test_system_to_lc(self):
        m = Message.system("系统提示")
        lc = m.to_langchain_message()
        assert lc is not None
        from langchain_core.messages import SystemMessage
        assert isinstance(lc, SystemMessage)
        assert lc.content == "系统提示"

    def test_user_to_lc(self):
        m = Message.user("用户输入")
        lc = m.to_langchain_message()
        from langchain_core.messages import HumanMessage
        assert isinstance(lc, HumanMessage)

    def test_assistant_to_lc(self):
        m = Message.assistant("模型回复")
        lc = m.to_langchain_message()
        from langchain_core.messages import AIMessage
        assert isinstance(lc, AIMessage)
        assert lc.content == "模型回复"

    def test_assistant_with_tool_calls_to_lc(self, tool_call):
        m = Message.assistant("", [tool_call])
        lc = m.to_langchain_message()
        from langchain_core.messages import AIMessage
        assert isinstance(lc, AIMessage)
        assert lc.tool_calls is not None
        assert len(lc.tool_calls) == 1
        assert lc.tool_calls[0]["name"] == "calculator"

    def test_tool_to_lc(self, tool_result):
        m = Message.tool_result(tool_result)
        lc = m.to_langchain_message()
        from langchain_core.messages import ToolMessage
        assert isinstance(lc, ToolMessage)
        assert lc.tool_call_id == "call_001"

    def test_roundtrip_system(self):
        m = Message.system("提示词")
        lc = m.to_langchain_message()
        back = Message.from_langchain_message(lc)
        assert back.role == "system"
        assert back.content == "提示词"

    def test_roundtrip_user(self):
        m = Message.user("你好")
        lc = m.to_langchain_message()
        back = Message.from_langchain_message(lc)
        assert back.role == "user"
        assert back.content == "你好"

    def test_roundtrip_assistant_with_tools(self, tool_call):
        m = Message.assistant("", [tool_call])
        lc = m.to_langchain_message()
        back = Message.from_langchain_message(lc)
        assert back.role == "assistant"
        assert len(back.tool_calls) == 1
        assert back.tool_calls[0].name == "calculator"

    def test_roundtrip_tool(self, tool_result):
        m = Message.tool_result(tool_result)
        lc = m.to_langchain_message()
        back = Message.from_langchain_message(lc)
        assert back.role == "tool"
        assert back.tool_call_id == "call_001"


# ============================================================
# Message 其他
# ============================================================

class TestMessageExtras:
    def test_unique_id(self):
        m1 = Message.user("a")
        m2 = Message.user("b")
        assert m1.id != m2.id

    def test_repr(self):
        m = Message.user("你好世界！这是一个测试消息")
        r = repr(m)
        assert "user" in r
        assert m.id in r
        assert "你好世界" in r

    def test_timestamp(self):
        m = Message.user("test")
        assert m.timestamp is not None

    def test_metadata_default(self):
        m = Message.user("test")
        assert m.metadata == {}

    def test_metadata_custom(self):
        m = Message.user("test")
        m.metadata = {"source": "cli", "priority": 1}
        assert m.metadata["source"] == "cli"

    def test_role_literal_type(self):
        """验证 Role 类型定义"""
        assert Role.__args__ == ("system", "user", "assistant", "tool")
