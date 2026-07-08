# -*- coding: utf-8 -*-
"""
消息系统 —— Agent 内部通信的基础类型

设计思路:
  一条消息 = role + content + 可选的 tool_call / tool_result
  四种角色对应 OpenAI 标准，兼容所有主流 LLM API

LangChain 集成:
  - to_langchain_message() → 转为 langchain_core.messages 类型
  - from_langchain_message() → 从 LangChain 消息还原
  - 支持 HumanMessage / AIMessage / SystemMessage / ToolMessage
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional, Any
from datetime import datetime
import json
import uuid
import logging

logger = logging.getLogger("smart_agent.message")


# ============================================================
# 1. 消息角色定义
# ============================================================

Role = Literal["system", "user", "assistant", "tool"]


# ============================================================
# 2. 工具调用 / 工具结果 子结构
# ============================================================

@dataclass
class ToolCall:
    """LLM 请求调用某个工具的包装"""
    id: str                    # 唯一调用 ID
    name: str                  # 工具名
    arguments: dict[str, Any]  # 参数
    call_time: datetime = field(default_factory=datetime.now)


@dataclass
class ToolResult:
    """工具执行后返回的结果"""
    call_id: str               # 对应的 ToolCall.id
    name: str                  # 工具名
    success: bool              # 是否成功
    result: Any = None         # 返回值 (JSON 可序列化)
    error: Optional[str] = None


# ============================================================
# 3. Message 核心类
# ============================================================

@dataclass
class Message:
    """
    统一消息体

    四种组合模式:
      system   → content (系统指令)
      user     → content (用户输入)
      assistant → content + 可选的 tool_calls (模型回复/请求工具)
      tool     → content (工具返回结果, 通过 tool_call_id 关联)
    """
    role: Role
    content: str = ""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: datetime = field(default_factory=datetime.now)

    # 扩展字段
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: Optional[str] = None   # tool 角色时关联的调用 ID
    metadata: dict[str, Any] = field(default_factory=dict)

    # ============ 序列化 ============

    def to_dict(self) -> dict:
        """转为 OpenAI 兼容格式"""
        d: dict[str, Any] = {"role": self.role, "content": self.content}

        if self.tool_calls:
            d["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                    },
                }
                for tc in self.tool_calls
            ]

        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id

        if self.role == "system":
            d.pop("tool_calls", None)

        return d

    def to_llm_format(self) -> dict:
        """去除内部字段，只保留 LLM 需要的格式"""
        return self.to_dict()

    # ============ LangChain 互转 ============

    def to_langchain_message(self):
        """
        转为 LangChain 标准消息类型

        Returns:
            SystemMessage / HumanMessage / AIMessage / ToolMessage
        """
        try:
            from langchain_core.messages import (
                SystemMessage, HumanMessage, AIMessage, ToolMessage
            )

            if self.role == "system":
                return SystemMessage(content=self.content)
            elif self.role == "user":
                return HumanMessage(content=self.content)
            elif self.role == "assistant":
                # 构建 tool_calls
                lc_tool_calls = []
                for tc in self.tool_calls:
                    lc_tool_calls.append({
                        "id": tc.id,
                        "name": tc.name,
                        "args": tc.arguments,
                        "type": "tool_call",
                    })
                msg = AIMessage(content=self.content)
                if lc_tool_calls:
                    msg.tool_calls = lc_tool_calls
                return msg
            elif self.role == "tool":
                return ToolMessage(
                    content=self.content,
                    tool_call_id=self.tool_call_id or "",
                )
            else:
                return HumanMessage(content=self.content)
        except ImportError:
            logger.warning("langchain_core 未安装，to_langchain_message() 不可用")
            return None

    @classmethod
    def from_langchain_message(cls, msg) -> "Message":
        """
        从 LangChain 标准消息类型还原为内部 Message

        Args:
            msg: SystemMessage / HumanMessage / AIMessage / ToolMessage
        """
        try:
            from langchain_core.messages import (
                SystemMessage, HumanMessage, AIMessage, ToolMessage
            )

            content = msg.content if isinstance(msg.content, str) else str(msg.content)

            if isinstance(msg, SystemMessage):
                return cls.system(content)
            elif isinstance(msg, HumanMessage):
                return cls.user(content)
            elif isinstance(msg, AIMessage):
                tool_calls = []
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    for tc in msg.tool_calls:
                        tool_calls.append(ToolCall(
                            id=tc.get("id", str(uuid.uuid4())[:8]),
                            name=tc.get("name", "unknown"),
                            arguments=tc.get("args", {}),
                        ))
                return cls.assistant(content, tool_calls)
            elif isinstance(msg, ToolMessage):
                return cls.tool_result_from_lc(msg)
            else:
                return cls.user(content)
        except ImportError:
            return cls.user(str(msg))

    @classmethod
    def tool_result_from_lc(cls, msg) -> "Message":
        """从 LangChain ToolMessage 创建"""
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        return cls(
            role="tool",
            content=content,
            tool_call_id=getattr(msg, "tool_call_id", ""),
        )

    # ============ 快捷构造 ============

    @classmethod
    def system(cls, content: str) -> "Message":
        return cls(role="system", content=content)

    @classmethod
    def user(cls, content: str) -> "Message":
        return cls(role="user", content=content)

    @classmethod
    def assistant(cls, content: str, tool_calls: list[ToolCall] | None = None) -> "Message":
        return cls(role="assistant", content=content,
                   tool_calls=tool_calls or [])

    @classmethod
    def tool_result(cls, result: ToolResult) -> "Message":
        return cls(
            role="tool",
            content=str(result.result) if result.success else f"Error: {result.error}",
            tool_call_id=result.call_id,
        )

    def __repr__(self) -> str:
        preview = self.content[:60].replace("\n", " ")
        return f"<Msg {self.role} [{self.id}]: {preview}>"


# ============================================================
# 自测
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("消息系统 演示")
    print("=" * 60)

    # 1. 系统提示
    sys_msg = Message.system("你是智能助手，擅长编码")
    print(f"系统消息: {sys_msg}")

    # 2. 用户输入
    user_msg = Message.user("帮我写一个排序算法")
    print(f"用户消息: {user_msg}")

    # 3. 模型回复 (带工具调用)
    tc = ToolCall(id="call_001", name="web_search",
                  arguments={"query": "Python 快速排序"})
    asst_msg = Message.assistant("让我搜索一下...", [tc])
    print(f"助手消息: {asst_msg}")
    print(f"  → 转为 LLM 格式: {json.dumps(asst_msg.to_llm_format(), indent=2, ensure_ascii=False)}")

    # 4. 工具结果
    tr = ToolResult(call_id="call_001", name="web_search",
                    success=True, result="找到 5 个结果")
    tool_msg = Message.tool_result(tr)
    print(f"工具消息: {tool_msg}")

    # 5. 测试 LangChain 互转
    lc_msg = asst_msg.to_langchain_message()
    if lc_msg:
        print(f"\nLangChain 转换: {type(lc_msg).__name__}")
        restored = Message.from_langchain_message(lc_msg)
        print(f"还原: {restored}")
    else:
        print("\nLangChain 转换不可用")

    print("\n消息系统正常工作!")
