# -*- coding: utf-8 -*-
"""
LLM 管理器 — 多 Provider 支持 + 流式输出

支持的 Provider (均兼容 OpenAI API 格式):
  - openai:    https://api.openai.com/v1
  - deepseek:  https://api.deepseek.com/v1
  - zhipu:     https://open.bigmodel.cn/api/paas/v4
  - ollama:    http://localhost:11434/v1
  - custom:    用户自定义 base_url

配置存储: backend/data/llm_config.json (运行时可更新)
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from openai import AsyncOpenAI

from ..config import PROJECT_ROOT

logger = logging.getLogger("ai_hubs.llm")

# ============================================================
# Provider 预设
# ============================================================

PROVIDERS: dict[str, dict] = {
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    },
    "deepseek": {
        "name": "DeepSeek (深度求索)",
        "base_url": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat", "deepseek-reasoner"],
    },
    "zhipu": {
        "name": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": ["glm-4", "glm-4-flash", "glm-4-plus"],
    },
    "ollama": {
        "name": "Ollama (本地)",
        "base_url": "http://localhost:11434/v1",
        "models": [],  # 动态获取
    },
    "custom": {
        "name": "自定义",
        "base_url": "",
        "models": [],
    },
}

# ============================================================
# 配置持久化
# ============================================================

_CONFIG_FILE = PROJECT_ROOT / "data" / "llm_config.json"


def load_llm_config() -> dict:
    """加载 LLM 配置"""
    if _CONFIG_FILE.exists():
        try:
            return json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_llm_config(config: dict) -> None:
    """保存 LLM 配置"""
    _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_FILE.write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(f"LLM 配置已保存: provider={config.get('provider')}, model={config.get('model')}")


def get_llm_config() -> dict:
    """获取当前 LLM 配置（合并默认值）"""
    saved = load_llm_config()
    provider = saved.get("provider", "deepseek")
    preset = PROVIDERS.get(provider, PROVIDERS["custom"])
    return {
        "provider": provider,
        "model": saved.get("model", preset["models"][0] if preset["models"] else ""),
        "api_key": saved.get("api_key", ""),
        "base_url": saved.get("base_url", preset["base_url"]),
        "temperature": saved.get("temperature", 0.7),
        "max_tokens": saved.get("max_tokens", 4096),
    }


# ============================================================
# LLM 管理器
# ============================================================

class LLMManager:
    """LLM 调用管理器"""

    def __init__(self):
        self._client: Optional[AsyncOpenAI] = None
        self._config: dict = {}

    def _resolve_config(self, user_config: Optional[dict] = None) -> dict:
        """解析实际使用的配置。

        - 若传入 user_config 且包含有效 api_key → 使用用户自己的配置（用户自带 key）。
        - 否则回退到平台全局配置（owner 的免费 key，受 token 配额限制）。
        """
        if user_config and user_config.get("api_key"):
            provider = user_config.get("provider", "custom")
            preset = PROVIDERS.get(provider, PROVIDERS["custom"])
            return {
                "provider": provider,
                "model": user_config.get("model", "") or (preset["models"][0] if preset["models"] else ""),
                "api_key": user_config["api_key"],
                "base_url": user_config.get("base_url") or preset["base_url"],
                "temperature": user_config.get("temperature", 0.7),
                "max_tokens": user_config.get("max_tokens", 4096),
                "is_user_owned": True,
            }
        cfg = get_llm_config()
        cfg = dict(cfg)
        cfg["is_user_owned"] = False
        return cfg

    def _ensure_client(self, user_config: Optional[dict] = None) -> AsyncOpenAI:
        """延迟创建客户端（使用最新配置）。user_config 为用户自带配置（可空）。"""
        config = self._resolve_config(user_config)
        self._config = config

        if not config["api_key"]:
            raise ValueError(
                "未配置 LLM API Key，请在设置中配置（或设置环境变量 OPENAI_API_KEY）"
            )

        # 每次创建新客户端（配置可能已更新）
        self._client = AsyncOpenAI(
            api_key=config["api_key"],
            base_url=config["base_url"],
        )
        return self._client

    async def stream_chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        user_config: Optional[dict] = None,
    ) -> AsyncGenerator[str, None]:
        """
        流式对话，逐 token 产出文本。

        messages: [{"role": "system"/"user"/"assistant", "content": "..."}]
        user_config: 用户自带 LLM 配置（含 api_key 时使用，否则用全局免费配置）
        Yields: 文本片段 (str)
        """
        client = self._ensure_client(user_config)
        config = self._config

        try:
            stream = await client.chat.completions.create(
                model=model or config["model"],
                messages=messages,
                temperature=temperature if temperature is not None else config["temperature"],
                max_tokens=max_tokens or config["max_tokens"],
                stream=True,
            )

            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error(f"LLM 流式调用失败: {e}")
            raise

    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """非流式对话，返回完整文本"""
        result = []
        async for chunk in self.stream_chat(messages, model, temperature):
            result.append(chunk)
        return "".join(result)

    async def stream_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        tool_executor,
        user_id: int,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        user_config: Optional[dict] = None,
        max_tool_rounds: int = 10,
    ) -> AsyncGenerator[dict, None]:
        """流式对话 + 工具调用循环。

        每次产出 dict 事件:
          {"type": "delta", "content": "文本片段"}
          {"type": "tool_start", "name": "run_code", "args": {...}, "summary": "执行 python..."}
          {"type": "tool_result", "name": "run_code", "result": "{...}"}
          {"type": "done"}

        tool_executor: async callable(tool_name, tool_args, user_id) -> str
        user_id: 当前用户 ID（传入 tool_executor 用于沙箱隔离）
        max_tool_rounds: 最多工具调用轮次，防无限循环
        """
        client = self._ensure_client(user_config)
        config = self._config
        current_model = model or config["model"]
        current_temp = temperature if temperature is not None else config["temperature"]
        current_max_tokens = max_tokens or config["max_tokens"]

        working_messages = [dict(m) for m in messages]  # 复制，避免修改原始列表

        for round_idx in range(max_tool_rounds):
            try:
                stream = await client.chat.completions.create(
                    model=current_model,
                    messages=working_messages,
                    temperature=current_temp,
                    max_tokens=current_max_tokens,
                    tools=tools,
                    tool_choice="auto" if round_idx < max_tool_rounds - 1 else "none",
                    stream=True,
                )
            except Exception as e:
                logger.error(f"LLM 工具调用失败 (round {round_idx}): {e}")
                raise

            # 累积流式响应中的文本和 tool_calls
            content_parts: list[str] = []
            tool_calls_map: dict[int, dict] = {}  # index -> {id, function_name, arguments}

            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                # 文本内容
                if delta.content:
                    content_parts.append(delta.content)
                    yield {"type": "delta", "content": delta.content}

                # 工具调用（可能跨多个 chunk）
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls_map:
                            tool_calls_map[idx] = {
                                "id": "",
                                "function_name": "",
                                "arguments": "",
                            }
                        entry = tool_calls_map[idx]
                        if tc_delta.id:
                            entry["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                entry["function_name"] = tc_delta.function.name
                            if tc_delta.function.arguments:
                                entry["arguments"] += tc_delta.function.arguments

                # 检查是否有 finish_reason
                finish = chunk.choices[0].finish_reason

            # 没有工具调用 — 对话结束
            if not tool_calls_map:
                yield {"type": "done"}
                return

            # 有工具调用 — 收集完整的 assistant message
            assistant_message: dict[str, Any] = {"role": "assistant", "content": "".join(content_parts) or None}
            tc_list = []
            for idx in sorted(tool_calls_map.keys()):
                entry = tool_calls_map[idx]
                tc_list.append({
                    "id": entry["id"],
                    "type": "function",
                    "function": {
                        "name": entry["function_name"],
                        "arguments": entry["arguments"],
                    },
                })
            assistant_message["tool_calls"] = tc_list
            working_messages.append(assistant_message)

            # 执行每个工具调用
            for tc in tc_list:
                tool_name = tc["function"]["name"]
                try:
                    tool_args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    tool_args = {}

                from .tools import get_tool_summary
                summary = get_tool_summary(tool_name, tool_args)
                yield {
                    "type": "tool_start",
                    "name": tool_name,
                    "args": tool_args,
                    "summary": summary,
                    "call_id": tc["id"],
                }

                # 执行工具（可能是同步或异步）
                try:
                    if asyncio.iscoroutinefunction(tool_executor):
                        result_str = await tool_executor(tool_name, tool_args, user_id)
                    else:
                        result_str = tool_executor(tool_name, tool_args, user_id)
                except Exception as e:
                    result_str = json.dumps({"error": f"工具执行异常: {e}"}, ensure_ascii=False)

                yield {
                    "type": "tool_result",
                    "name": tool_name,
                    "result": result_str,
                    "call_id": tc["id"],
                }

                # 将工具结果添加到消息历史
                working_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result_str,
                })

                # request_user_input 的结果中可能包含交互事件，提取并转发
                if tool_name == "request_user_input":
                    try:
                        parsed = json.loads(result_str)
                        interactive = parsed.get("interactive")
                        if interactive and isinstance(interactive, dict):
                            yield {"type": "interactive", **interactive}
                    except (json.JSONDecodeError, TypeError):
                        pass

        # 超过最大轮次，结束
        yield {"type": "done"}

    def is_configured(self) -> bool:
        """检查是否已配置"""
        config = get_llm_config()
        return bool(config.get("api_key"))


# 全局单例
llm_manager = LLMManager()
