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
    enable_planning: bool = False
    enable_rag: bool = True
    enable_reflection: bool = False
    max_iterations: int = Field(default=15, ge=1, le=100)
    memory_strength: float = Field(default=3.0, ge=0, le=5)
    setup_mode: str = "detailed"
    skills: list[str] = []
    tags: list[str] = []
    category: str = "general"


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
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
