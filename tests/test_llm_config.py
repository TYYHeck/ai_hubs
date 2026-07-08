# -*- coding: utf-8 -*-
"""LLM 配置单元测试 —— LLMConfig / BaseLLM / OpenAIClient"""

from __future__ import annotations
import os
import pytest
from src.core.llm import LLMConfig, BaseLLM, create_llm, OpenAIClient
from src.core.message import Message


# ============================================================
# LLMConfig
# ============================================================

class TestLLMConfig:
    def test_defaults(self):
        cfg = LLMConfig()
        assert cfg.provider == "openai"
        assert cfg.model == "gpt-4o"
        assert cfg.temperature == 0.7
        assert cfg.max_tokens == 4096

    def test_resolve_base_url_explicit(self):
        cfg = LLMConfig(base_url="https://my.api.com")
        assert cfg.resolve_base_url() == "https://my.api.com"

    def test_resolve_base_url_default_openai(self):
        cfg = LLMConfig(provider="openai")
        assert "openai.com" in cfg.resolve_base_url()

    def test_resolve_base_url_default_deepseek(self):
        cfg = LLMConfig(provider="deepseek")
        assert "deepseek.com" in cfg.resolve_base_url()

    def test_resolve_base_url_custom_empty(self):
        cfg = LLMConfig(provider="custom")
        assert cfg.resolve_base_url() == ""

    def test_resolve_api_key_explicit(self, llm_config_openai):
        assert llm_config_openai.resolve_api_key() == "sk-test123"

    def test_resolve_api_key_from_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
        cfg = LLMConfig(provider="openai")
        assert cfg.resolve_api_key() == "sk-from-env"

    def test_resolve_api_key_deepseek_env(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds-env")
        cfg = LLMConfig(provider="deepseek")
        assert cfg.resolve_api_key() == "sk-ds-env"

    def test_resolve_api_key_dollar_syntax(self, monkeypatch):
        monkeypatch.setenv("MY_KEY", "sk-dollar")
        cfg = LLMConfig(provider="openai", api_key="${MY_KEY}")
        assert cfg.resolve_api_key() == "sk-dollar"

    def test_custom_base_url(self, llm_config_custom):
        assert llm_config_custom.resolve_base_url() == "https://custom.api.com/v1"


# ============================================================
# create_llm 工厂函数
# ============================================================

class TestCreateLLM:
    @pytest.mark.parametrize("provider", [
        "openai", "deepseek", "zhipu", "qwen", "ollama", "custom",
    ])
    def test_creates_for_provider(self, provider):
        cfg = LLMConfig(provider=provider, api_key="sk-test")
        llm = create_llm(cfg)
        assert isinstance(llm, BaseLLM)
        assert isinstance(llm, OpenAIClient)
        assert llm.config.provider == provider

    def test_raises_unknown_provider(self):
        cfg = LLMConfig(provider="unknown_ai", api_key="x")
        with pytest.raises(ValueError, match="不支持的"):
            create_llm(cfg)

    def test_case_insensitive(self):
        cfg = LLMConfig(provider="DeepSeek", api_key="x")
        llm = create_llm(cfg)
        assert isinstance(llm, OpenAIClient)


# ============================================================
# OpenAIClient 配置
# ============================================================

class TestOpenAIClientConfig:
    def test_stores_config(self, llm_config_deepseek):
        client = OpenAIClient(llm_config_deepseek)
        assert client.config.provider == "deepseek"
        assert client.config.model == "deepseek-chat"

    def test_default_base_urls(self):
        mapping = LLMConfig(provider="openai").DEFAULT_BASE_URL
        assert "deepseek.com" in mapping["deepseek"]
        assert "openai.com" in mapping["openai"]
        assert "bigmodel.cn" in mapping["zhipu"]
        assert "aliyuncs.com" in mapping["qwen"]
        assert "localhost" in mapping["ollama"]


# ============================================================
# as_langchain
# ============================================================

class TestAsLangchain:
    def test_returns_chat_openai(self, llm_config_deepseek):
        client = OpenAIClient(llm_config_deepseek)
        lc_model = client.as_langchain()
        assert lc_model is not None
        from langchain_openai import ChatOpenAI
        assert isinstance(lc_model, ChatOpenAI)
        assert lc_model.model_name == "deepseek-chat"

    def test_with_custom_base_url(self, llm_config_custom):
        client = OpenAIClient(llm_config_custom)
        lc_model = client.as_langchain()
        assert lc_model is not None


# ============================================================
# _build_messages 内部转换
# ============================================================

class TestBuildMessages:
    def test_system_message(self, llm_config_deepseek):
        client = OpenAIClient(llm_config_deepseek)
        msgs = [Message.system("你是助手")]
        api_msgs = client._build_messages(msgs)
        assert len(api_msgs) == 1
        assert api_msgs[0]["role"] == "system"
        assert api_msgs[0]["content"] == "你是助手"

    def test_user_message(self, llm_config_deepseek):
        client = OpenAIClient(llm_config_deepseek)
        msgs = [Message.user("你好")]
        api_msgs = client._build_messages(msgs)
        assert api_msgs[0]["role"] == "user"

    def test_assistant_with_tool_calls(self, llm_config_deepseek):
        from src.core.message import ToolCall
        client = OpenAIClient(llm_config_deepseek)
        tc = ToolCall(id="c1", name="calc", arguments={"expr": "2+2"})
        msgs = [Message.assistant("", [tc])]
        api_msgs = client._build_messages(msgs)
        assert api_msgs[0]["role"] == "assistant"
        assert "tool_calls" in api_msgs[0]
        assert len(api_msgs[0]["tool_calls"]) == 1

    def test_tool_message(self, llm_config_deepseek):
        from src.core.message import ToolResult
        client = OpenAIClient(llm_config_deepseek)
        tr = ToolResult(call_id="c1", name="calc", success=True, result="4")
        msgs = [Message.tool_result(tr)]
        api_msgs = client._build_messages(msgs)
        assert api_msgs[0]["role"] == "tool"
        assert api_msgs[0]["tool_call_id"] == "c1"

    def test_mixed_messages(self, llm_config_deepseek):
        client = OpenAIClient(llm_config_deepseek)
        msgs = [
            Message.system("sys"),
            Message.user("user"),
            Message.assistant("ai"),
        ]
        api_msgs = client._build_messages(msgs)
        assert len(api_msgs) == 3
        roles = [m["role"] for m in api_msgs]
        assert roles == ["system", "user", "assistant"]


# ============================================================
# ENV_KEY_MAP
# ============================================================

class TestEnvKeyMap:
    def test_all_providers_mapped(self):
        mapping = LLMConfig(provider="openai").ENV_KEY_MAP
        assert "openai" in mapping
        assert "deepseek" in mapping
        assert "zhipu" in mapping
        assert "qwen" in mapping
        assert "ollama" in mapping
