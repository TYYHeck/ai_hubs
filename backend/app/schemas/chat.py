# -*- coding: utf-8 -*-
"""对话 Pydantic 模型"""

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """流式对话请求"""
    message: str = Field(..., description="用户消息")
    conversation_id: str | None = Field(None, description="对话 ID，为空则新建")
    agent_name: str | None = Field(None, description="Agent 名称")
    system_prompt: str | None = Field(None, description="系统提示词")
    think_visibility: str = Field("visible", description="思考可见性: visible|hidden|folded")


class CreateConversationRequest(BaseModel):
    title: str = Field("新对话", description="对话标题")
    agent_name: str | None = None


class LLMConfigRequest(BaseModel):
    """LLM 配置更新"""
    provider: str = Field(..., description="提供商: openai|deepseek|zhipu|ollama|custom")
    model: str = Field(..., description="模型名称")
    api_key: str = Field(..., description="API Key")
    base_url: str | None = Field(None, description="自定义 API 地址")
    temperature: float = Field(0.7, ge=0, le=2)
    max_tokens: int = Field(4096, ge=1, le=32768)
