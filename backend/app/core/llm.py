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
        "embedding_models": ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
    },
    "deepseek": {
        "name": "DeepSeek (深度求索)",
        "base_url": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "embedding_models": [],  # DeepSeek 不提供 embedding 端点
    },
    "zhipu": {
        "name": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": ["glm-4", "glm-4-flash", "glm-4-plus"],
        "embedding_models": ["embedding-3", "embedding-2"],
    },
    "ollama": {
        "name": "Ollama (本地)",
        "base_url": "http://localhost:11434/v1",
        "models": [],  # 动态获取
        "embedding_models": ["nomic-embed-text", "bge-m3"],
    },
    "custom": {
        "name": "自定义",
        "base_url": "",
        "models": [],
        "embedding_models": [],
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


def get_embedding_config() -> dict:
    """获取 embedding（向量化）配置，与对话 LLM 解耦。

    读取 llm_config.json 的 `embedding` 段：
      {
        "enabled": true,
        "provider": "openai",            # 复用 PROVIDERS 预设（取 embedding_models[0]）
        "model": "text-embedding-3-small",
        "base_url": "...",               # 留空则取 provider 预设
        "api_key": "...",                # 留空则复用对话 LLM 的 api_key
        "dimensions": null               # 预留（部分模型支持），当前自动探测
      }

    未启用或无 key 时返回 {"enabled": False}，调用方应回退 BM25。
    """
    saved = load_llm_config()
    emb = saved.get("embedding") or {}
    if not emb.get("enabled", False):
        return {"enabled": False}

    provider = emb.get("provider", "openai")
    preset = PROVIDERS.get(provider, PROVIDERS["openai"])
    emb_models = preset.get("embedding_models") or []

    model = emb.get("model") or (emb_models[0] if emb_models else "text-embedding-3-small")
    base_url = emb.get("base_url") or preset.get("base_url", "https://api.openai.com/v1")
    api_key = emb.get("api_key") or saved.get("api_key", "")

    return {
        "enabled": True,
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "api_key": api_key,
        "dimensions": emb.get("dimensions"),
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
        on_usage: Optional[Callable[[int, int], None]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        流式对话，逐 token 产出文本。

        messages: [{"role": "system"/"user"/"assistant", "content": "..."}]
        user_config: 用户自带 LLM 配置（含 api_key 时使用，否则用全局免费配置）
        on_usage: 可选回调 (prompt_tokens, completion_tokens)，用于上报真实 token 用量
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
                stream_options={"include_usage": True},
            )

            async for chunk in stream:
                # 真实 token 用量（流式末尾 chunk 携带，choices 可能为空）
                if getattr(chunk, "usage", None) and on_usage is not None:
                    u = chunk.usage
                    on_usage(int(u.prompt_tokens or 0), int(u.completion_tokens or 0))
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

    @staticmethod
    def _salvage_malformed_json(raw: str, tool_name: str) -> dict:
        """从残缺 JSON 中尽力抢救参数。

        常见失败场景：
        1. LLM 输出被 max_tokens 截断，JSON 未闭合
        2. content 内嵌的代码未正确转义引号/换行，导致 JSON 提前断裂
        """
        import re
        result: dict = {}

        # 策略1：尝试补全截断的 JSON（追加缺失的 }" 等）
        if not raw.strip():
            return {"_json_error": "arguments 为空字符串"}
        if raw.strip()[-1] not in ("}", "]"):
            # JSON 可能被截断，尝试补全
            repaired = raw.rstrip()
            # 统计未闭合的大括号
            brace_diff = repaired.count("{") - repaired.count("}")
            repaired += "}" * max(brace_diff, 0)
            # 统计未闭合的引号（简单启发）
            quote_count = repaired.count('"')
            if quote_count % 2 != 0:
                repaired += '"'
            try:
                result = json.loads(repaired)
                logger.info(f"JSON 修复成功 [{tool_name}]: 补全 {brace_diff} 个括号")
                return result
            except json.JSONDecodeError:
                pass

        # 策略2：正则提取已知参数（write_file 的 path + content）
        if tool_name == "write_file":
            path_m = re.search(r'"path"\s*:\s*"([^"]*)"', raw)
            if path_m:
                result["path"] = path_m.group(1)
            # content 值可能很大且含转义，尝试从 "content": " 开始截取
            content_m = re.search(r'"content"\s*:\s*"', raw)
            if content_m:
                start = content_m.end()
                # 取到最后一个未转义引号之前
                remaining = raw[start:]
                # 找最后一个 " 但排除 \"
                last_quote = -1
                i = 0
                while i < len(remaining):
                    if remaining[i] == "\\" and i + 1 < len(remaining):
                        i += 2  # 跳过转义字符
                        continue
                    if remaining[i] == '"':
                        last_quote = i
                    i += 1
                if last_quote >= 0:
                    # 还原 JSON 转义
                    import codecs
                    raw_content = remaining[:last_quote]
                    try:
                        result["content"] = codecs.decode(raw_content, "unicode_escape")
                    except Exception:
                        result["content"] = raw_content

            if result.get("path") and result.get("content"):
                logger.info(f"JSON 正则抢救成功 [write_file]: path={result['path'][:80]}, content_len={len(result['content'])}")

        if not result:
            result["_json_error"] = f"JSON 解析失败: {raw[:200]}..."

        return result

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
        on_usage: Optional[Callable[[int, int], None]] = None,
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

        # 真实 token 用量累加（多轮工具调用各自携带 usage）
        _acc_prompt = 0
        _acc_completion = 0

        def _flush_usage() -> None:
            if on_usage is not None:
                on_usage(_acc_prompt, _acc_completion)

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
                    stream_options={"include_usage": True},
                )
            except Exception as e:
                logger.error(f"LLM 工具调用失败 (round {round_idx}): {e}")
                raise

            # 累积流式响应中的文本和 tool_calls
            content_parts: list[str] = []
            tool_calls_map: dict[int, dict] = {}  # index -> {id, function_name, arguments}

            async for chunk in stream:
                # 真实 token 用量（流式末尾 chunk 携带，choices 可能为空）
                if getattr(chunk, "usage", None):
                    u = chunk.usage
                    _acc_prompt += int(u.prompt_tokens or 0)
                    _acc_completion += int(u.completion_tokens or 0)
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

            # 流式完成后记录各工具参数长度（用于诊断截断问题）
            for idx, entry in tool_calls_map.items():
                arg_len = len(entry.get("arguments", ""))
                if arg_len > 500:
                    logger.debug(
                        f"LLM tool_call 流式完成 [{entry.get('function_name', '?')}]: "
                        f"arguments_len={arg_len}"
                    )

            # 没有工具调用 — 对话结束
            if not tool_calls_map:
                _flush_usage()
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
                raw_args = tc["function"]["arguments"]
                try:
                    tool_args = json.loads(raw_args)
                except json.JSONDecodeError as e:
                    logger.warning(
                        f"LLM tool_call JSON 解析失败 [{tool_name}]: {e} | "
                        f"len={len(raw_args)} | "
                        f"head={raw_args[:120]!r} | "
                        f"tail={raw_args[-120:]!r}"
                    )
                    # 尝试从残缺 JSON 中抢救参数
                    tool_args = self._salvage_malformed_json(raw_args, tool_name)

                # 仅含 _json_error 且关键参数缺位 → 直接返回错误，不调用实际工具
                if tool_args.get("_json_error"):
                    logger.warning(
                        f"LLM tool_call 参数抢救失败 [{tool_name}]: "
                        f"raw_len={len(raw_args)}, error={tool_args['_json_error']}"
                    )
                    result_str = json.dumps({
                        "ok": False,
                        "error": (
                            f"工具调用参数 JSON 格式错误，无法解析。"
                            f"原始参数字符串长度 {len(raw_args)} 字符。"
                            f"请检查 JSON 格式（引号转义、括号闭合）后重试。"
                            f"建议：若 content 包含大量代码，请确保其中双引号和反斜杠已正确转义。"
                        ),
                    }, ensure_ascii=False)
                    yield {
                        "type": "tool_result",
                        "name": tool_name,
                        "result": result_str,
                        "call_id": tc["id"],
                    }
                    working_messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result_str,
                    })
                    continue  # 跳过实际工具执行

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

                # ui_action 的结果中包含 UI 操作事件，提取并转发
                if tool_name == "ui_action":
                    try:
                        parsed = json.loads(result_str)
                        ui_action = parsed.get("ui_action")
                        if ui_action and isinstance(ui_action, dict):
                            yield {"type": "ui_action", **ui_action}
                    except (json.JSONDecodeError, TypeError):
                        pass

        # 超过最大轮次，结束
        _flush_usage()
        yield {"type": "done"}

    def is_configured(self) -> bool:
        """检查是否已配置"""
        config = get_llm_config()
        return bool(config.get("api_key"))


# 全局单例
llm_manager = LLMManager()
