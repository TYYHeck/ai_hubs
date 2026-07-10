# -*- coding: utf-8 -*-
"""
LLM 引擎 —— Agent 与各种大模型交互的统一接口

设计思路:
  1. 自研 BaseLLM + OpenAIClient 保留原始兼容性
  2. as_langchain() 方法 → 转换为 LangChain ChatOpenAI 实例
  3. 支持多提供商: OpenAI / DeepSeek / 通义千问 / 智谱 / Ollama

LangChain 集成:
  - 主路径: 通过 as_langchain() 获取 langchain_openai.ChatOpenAI
  - 兼容路径: 保留 chat() / chat_stream() / chat_async() 原始接口
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import AsyncIterator, Iterator, Optional, Any
from dataclasses import dataclass, field
import os
import re
import json
import asyncio
import logging

from .message import Message, ToolCall

logger = logging.getLogger("ai_hubs.llm")


# ============================================================
# 1. 配置数据类
# ============================================================

@dataclass
class LLMConfig:
    """LLM 配置 - 支持多提供商"""

    provider: str = "openai"        # openai / deepseek / zhipu / qwen / custom
    model: str = "gpt-4o"
    api_key: str = ""
    base_url: str = ""
    temperature: float = 0.7
    max_tokens: int = 4096
    timeout: int = 120
    think_depth: int = 0  # 思考深度 1-5，>1 时增强推理强度（0 表示未指定，回退为 1）

    # 环境变量名映射
    ENV_KEY_MAP: dict[str, str] = field(default_factory=lambda: {
        "openai": "OPENAI_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "zhipu": "ZHIPU_API_KEY",
        "qwen": "DASHSCOPE_API_KEY",
        "ollama": "OLLAMA_API_KEY",
    }, init=False, repr=False)

    # 默认 base_url 映射
    DEFAULT_BASE_URL: dict[str, str] = field(default_factory=lambda: {
        "openai": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com",
        "zhipu": "https://open.bigmodel.cn/api/paas/v4",
        "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "ollama": "http://localhost:11434/v1",
    }, init=False, repr=False)

    def resolve_base_url(self) -> str:
        """解析 base_url: 配置值 → provider 默认值"""
        if self.base_url:
            return self.base_url
        return self.DEFAULT_BASE_URL.get(self.provider, "")

    def resolve_api_key(self) -> str:
        """自动解析 API Key: 配置值 → provider 环境变量 → OPENAI_API_KEY 兜底"""
        if self.api_key and not self.api_key.startswith("$"):
            return self.api_key

        # 支持 ${VAR} 语法
        match = re.match(r"\$\{(\w+)\}", self.api_key)
        if match:
            return os.getenv(match.group(1), "")

        # 先按 provider 查找
        env_var = self.ENV_KEY_MAP.get(
            self.provider,
            f"{self.provider.upper()}_API_KEY"
        )
        result = os.getenv(env_var, "")
        if result:
            return result

        # 兜底：OPENAI_API_KEY 作为通用 fallback
        fallback = os.getenv("OPENAI_API_KEY", "")
        if fallback:
            return fallback

        return self.api_key


# ============================================================
# 2. 抽象接口
# ============================================================

class BaseLLM(ABC):
    """LLM 抽象基类 —— 所有模型提供商必须实现"""

    config: LLMConfig

    @abstractmethod
    def chat(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
        stream: bool = False,
    ) -> Message:
        """发送消息并获取回复 (同步)"""
        ...

    @abstractmethod
    async def chat_async(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
        stream: bool = False,
    ) -> Message:
        """发送消息并获取回复 (异步)"""
        ...

    @abstractmethod
    def chat_stream(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
    ) -> Iterator[str]:
        """流式调用 - 逐字返回"""
        ...

    def as_langchain(self):
        """
        转换为 LangChain ChatModel 实例

        返回 langchain_openai.ChatOpenAI，以便 LangChain Agent 使用。
        如果不可用，返回 None（此时 Agent 会使用兼容路径）。
        """
        try:
            from langchain_openai import ChatOpenAI

            api_key = self.config.resolve_api_key()
            base_url = self.config.resolve_base_url()

            kwargs: dict[str, Any] = {
                "model": self.config.model,
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
                "timeout": self.config.timeout,
                "max_retries": 2,
            }

            if api_key:
                kwargs["api_key"] = api_key
            if base_url:
                kwargs["base_url"] = base_url

            # Ollama 特殊处理
            if self.config.provider == "ollama":
                kwargs["api_key"] = api_key or "ollama"

            return ChatOpenAI(**kwargs)

        except ImportError:
            logger.warning(
                "langchain_openai 未安装，无法使用 LangChain Agent 模式。"
                "请运行: pip install langchain-openai"
            )
            return None
        except Exception as e:
            logger.warning(f"创建 LangChain ChatModel 失败: {e}")
            return None


# ============================================================
# 3. OpenAI 兼容实现
# ============================================================

class OpenAIClient(BaseLLM):
    """
    基于 OpenAI Python SDK 实现
    兼容所有 OpenAI-compatible API:
      - OpenAI 官方: api.openai.com
      - DeepSeek: api.deepseek.com
      - 阿里通义: dashscope.aliyuncs.com
      - 智谱GLM: open.bigmodel.cn
      - 豆包: ark.cn-beijing.volces.com
      - 本地 Ollama: localhost:11434
    """

    def __init__(self, config: LLMConfig):
        self.config = config
        self._client = None
        self._async_client = None

    # ======== 延迟初始化客户端 ========

    @property
    def client(self):
        if self._client is None:
            from openai import OpenAI
            api_key = self.config.resolve_api_key()
            if not api_key:
                raise ValueError(
                    f"缺少 API Key! 请设置环境变量或修改 config.yaml\n"
                    f"  当前 provider: {self.config.provider}\n"
                    f"  需要环境变量: {self.config.ENV_KEY_MAP.get(self.config.provider)}"
                )

            kwargs: dict[str, Any] = {
                "api_key": api_key,
                "timeout": self.config.timeout,
            }
            base_url = self.config.resolve_base_url()
            if base_url:
                kwargs["base_url"] = base_url
            self._client = OpenAI(**kwargs)
        return self._client

    @property
    def async_client(self):
        if self._async_client is None:
            from openai import AsyncOpenAI
            api_key = self.config.resolve_api_key()
            kwargs: dict[str, Any] = {
                "api_key": api_key,
                "timeout": self.config.timeout,
            }
            base_url = self.config.resolve_base_url()
            if base_url:
                kwargs["base_url"] = base_url
            self._async_client = AsyncOpenAI(**kwargs)
        return self._async_client

    # ======== 消息格式转换 ========

    def _effective_max_tokens(self) -> int:
        """思考深度越高，允许更长的输出/推理（上限保护）"""
        depth = max(1, self.config.think_depth or 1)
        if depth <= 1:
            return self.config.max_tokens
        factor = 1 + 0.4 * (depth - 1)
        return min(8000, int(self.config.max_tokens * factor))

    def _build_messages(self, messages: list[Message]) -> list[dict]:
        """将内部 Message 列表转为 OpenAI API 格式"""
        api_msgs: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "system":
                api_msgs.append({"role": "system", "content": msg.content})
                continue

            d: dict[str, Any] = {"role": msg.role, "content": msg.content}

            if msg.tool_calls and msg.role == "assistant":
                d["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                        },
                    }
                    for tc in msg.tool_calls
                ]

            if msg.tool_call_id:
                d["tool_call_id"] = msg.tool_call_id

            api_msgs.append(d)

        # ── 思考深度注入：将深度指令融入首条 system 消息 ──
        depth = max(1, self.config.think_depth or 1)
        if depth > 1:
            instr = (
                f"\n[思考深度要求: {depth}/5] 这是一个需要深度思考的任务。"
                "请充分调动推理能力：先拆解问题、多角度分析、评估多种方案，"
                "再给出严谨且完整的回答。不要急于下结论，确保推理链清晰可信。"
            )
            for m in api_msgs:
                if m.get("role") == "system":
                    m["content"] = (str(m["content"]) + instr)
                    break
            else:
                api_msgs.insert(0, {"role": "system", "content": instr.strip()})
        return api_msgs

    # ======== 同步调用 ========

    def chat(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
        stream: bool = False,
    ) -> Message:
        api_msgs = self._build_messages(messages)
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": api_msgs,
            "temperature": self.config.temperature,
            "max_tokens": self._effective_max_tokens(),
        }
        if tools:
            kwargs["tools"] = tools

        response = self.client.chat.completions.create(**kwargs)
        return self._parse_response(response)

    # ======== 流式调用 ========

    def chat_stream(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
    ) -> Iterator[str]:
        """流式逐字返回 - 用于打字机效果"""
        api_msgs = self._build_messages(messages)
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": api_msgs,
            "temperature": self.config.temperature,
            "max_tokens": self._effective_max_tokens(),
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools

        stream = self.client.chat.completions.create(**kwargs)
        for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    # ======== 异步调用 ========

    async def chat_async(
        self,
        messages: list[Message],
        tools: list[dict] | None = None,
        stream: bool = False,
    ) -> Message:
        api_msgs = self._build_messages(messages)
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": api_msgs,
            "temperature": self.config.temperature,
            "max_tokens": self._effective_max_tokens(),
        }
        if tools:
            kwargs["tools"] = tools

        response = await self.async_client.chat.completions.create(**kwargs)
        return self._parse_response(response)

    # ======== 响应解析 ========

    def _parse_response(self, response) -> Message:
        """解析 OpenAI 响应为内部 Message"""
        choice = response.choices[0]
        msg = choice.message

        tool_calls: list[ToolCall] = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                tool_calls.append(ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=args,
                ))

        return Message.assistant(
            content=msg.content or "",
            tool_calls=tool_calls,
        )


# ============================================================
# 4. 工厂函数 - 根据配置创建 LLM 实例
# ============================================================

def create_llm(config: LLMConfig) -> BaseLLM:
    """根据 provider 创建对应的 LLM 客户端"""
    provider = config.provider.lower()
    if provider in ("openai", "deepseek", "zhipu", "qwen", "ollama", "custom"):
        return OpenAIClient(config)
    raise ValueError(f"不支持的 LLM 提供商: {provider}")


# ============================================================
# 自测
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("LLM 引擎 演示")
    print("=" * 60)

    config = LLMConfig(
        provider="deepseek",
        model="deepseek-chat",
        temperature=0.5,
    )
    print(f"Provider: {config.provider}")
    print(f"Model: {config.model}")
    print(f"API Key 状态: {'已设置' if config.resolve_api_key() else '未设置'}")

    if config.resolve_api_key():
        llm = create_llm(config)

        # 同步调用测试
        msgs = [
            Message.system("你是一个简洁的助手，用中文回答。"),
            Message.user("什么是 Agent？用一句话解释。"),
        ]
        response = llm.chat(msgs)
        print(f"\n回复: {response.content}")

        # 测试 LangChain 转换
        lc_model = llm.as_langchain()
        if lc_model:
            print(f"\nLangChain ChatModel 创建成功: {type(lc_model).__name__}")
        else:
            print("\nLangChain ChatModel 不可用")

        # 流式调用测试
        print("\n流式: ", end="", flush=True)
        for token in llm.chat_stream(msgs):
            print(token, end="", flush=True)
        print()
    else:
        print("\n请设置 DEEPSEEK_API_KEY 环境变量后重新运行")
