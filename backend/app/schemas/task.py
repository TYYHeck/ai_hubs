# -*- coding: utf-8 -*-
"""任务 Pydantic 模型"""

from typing import Optional

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    """创建任务"""
    title: str = Field(..., min_length=1, max_length=256)
    description: str = ""
    mode: str = Field(default="single", pattern=r"^(single|sequential|parallel|debate|vote|hierarchical|swarm|custom)$")
    think_depth: int = Field(default=1, ge=1, le=3)
    think_visibility: str = Field(default="visible", pattern=r"^(visible|hidden|folded)$")
    agent_ids: list[int] = []           # 指定 Agent IDs，空则用默认
    priority: int = Field(default=0, ge=0, le=10)
    tags: list[str] = []
    # 可选：自定义编排管道 (mode=custom 时)
    pipeline_steps: Optional[list[str]] = None  # ["agent_id:prompt_suffix", ...]


class TaskResponse(BaseModel):
    id: str
    title: str
    description: str
    status: str
    priority: int
    tags: list[str] = []
    assigned_agent: Optional[str] = None
    mode: str
    think_depth: int
    think_visibility: str
    result: Optional[str] = None
    error: Optional[str] = None
    metadata: dict = {}
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

    class Config:
        from_attributes = True


class TaskEventResponse(BaseModel):
    """任务事件"""
    time: Optional[str] = None
    event: str
    data: Optional[dict] = None


class TaskDetailResponse(TaskResponse):
    """任务详情（含事件日志）"""
    events: list[TaskEventResponse] = []
    agents: list[dict] = []  # 参与该任务的 Agent 简要信息
