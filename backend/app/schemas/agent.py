# -*- coding: utf-8 -*-
"""Agent Pydantic 模型"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    system_prompt: Optional[str] = None
    model: str = "deepseek-chat"
    provider: str = "deepseek"
    config_mode: str = "global"  # global | self
    is_default: bool = False
    enable_planning: bool = False
    enable_rag: bool = True
    enable_reflection: bool = False
    max_iterations: int = Field(default=15, ge=1, le=100)
    memory_strength: float = Field(default=3.0, ge=0, le=5)
    setup_mode: str = "quick"
    skills: list[str] = []
    tags: list[str] = []
    category: str = "general"


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    config_mode: Optional[str] = None
    is_default: Optional[bool] = None
    enable_planning: Optional[bool] = None
    enable_rag: Optional[bool] = None
    enable_reflection: Optional[bool] = None
    max_iterations: Optional[int] = Field(None, ge=1, le=100)
    memory_strength: Optional[float] = Field(None, ge=0, le=5)
    setup_mode: Optional[str] = None
    skills: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    category: Optional[str] = None


class AgentResponse(BaseModel):
    id: int
    name: str
    description: str
    system_prompt: Optional[str] = None
    model: str
    provider: str
    config_mode: str = "global"
    is_default: bool = False
    enable_planning: bool
    enable_rag: bool
    enable_reflection: bool
    max_iterations: int
    memory_strength: float
    setup_mode: str
    skills: list[str] = []
    tags: list[str] = []
    category: str
    status: str
    current_task_id: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class AgentAnalyzeRequest(BaseModel):
    """快速配置：根据名称与描述，让 AI 分析并推荐技能、标签，并生成 system prompt 草稿"""
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    available_skills: list[str] = []  # 当前已安装的技能名列表（供 AI 从中挑选）


class AgentAnalyzeResponse(BaseModel):
    """AI 分析结果"""
    ok: bool = True
    suggested_skills: list[str] = []   # 推荐技能（从 available_skills 中挑选）
    suggested_tags: list[str] = []     # 推荐标签
    category: str = "general"          # 推荐分类
    system_prompt_draft: str = ""      # 生成的 system prompt 草稿（隐藏填写界面预填）
