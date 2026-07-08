# -*- coding: utf-8 -*-
"""
结构化输出模型 —— Agent 回复的 Pydantic Schema

用于强制 LLM 按照指定结构输出（json_mode / structured output）。
与 LangChain 的 with_structured_output() 配合使用。
"""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, Any


class AgentResponse(BaseModel):
    """Agent 标准回复"""
    answer: str = Field(description="给用户的完整回复")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0,
                              description="置信度 0-1")
    sources: list[str] = Field(default_factory=list,
                               description="信息来源列表")
    tool_calls_made: int = Field(default=0,
                                 description="本论调用的工具次数")
    needs_followup: bool = Field(default=False,
                                 description="是否需要用户补充信息")


class TaskPlan(BaseModel):
    """任务计划"""
    goal: str = Field(description="总目标")
    steps: list[str] = Field(description="分解步骤列表")
    estimated_iterations: int = Field(default=3,
                                      description="预估迭代次数")


class ToolCallResult(BaseModel):
    """工具调用结果"""
    tool_name: str
    success: bool
    data: Any = None
    error: Optional[str] = None


class ReflectionResult(BaseModel):
    """反思结果"""
    is_satisfactory: bool = Field(description="答案是否满足要求")
    issues: list[str] = Field(default_factory=list,
                              description="发现的问题")
    improved_answer: Optional[str] = Field(default=None,
                                           description="改进后的答案")


class CodeExecution(BaseModel):
    """代码执行结果"""
    language: str = Field(default="python")
    output: str = Field(description="stdout 输出")
    error: Optional[str] = Field(default=None, description="stderr")
    execution_time_ms: float = Field(default=0.0,
                                     description="执行耗时(毫秒)")
