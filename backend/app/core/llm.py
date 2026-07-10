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

import json
import logging
from pathlib import Path
from typing import AsyncGenerator, Optional

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

    def _ensure_client(self) -> AsyncOpenAI:
        """延迟创建客户端（使用最新配置）"""
        config = get_llm_config()
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
    ) -> AsyncGenerator[str, None]:
        """
        流式对话，逐 token 产出文本。

        messages: [{"role": "system"/"user"/"assistant", "content": "..."}]
        Yields: 文本片段 (str)
        """
        client = self._ensure_client()
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

    def is_configured(self) -> bool:
        """检查是否已配置"""
        config = get_llm_config()
        return bool(config.get("api_key"))


# 全局单例
llm_manager = LLMManager()
