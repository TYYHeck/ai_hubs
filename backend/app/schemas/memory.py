# -*- coding: utf-8 -*-
"""记忆系统 Pydantic 模型"""

from typing import Any, Optional

from pydantic import BaseModel, Field


class MemoryCommitResponse(BaseModel):
    id: int
    commit_hash: str
    message: str
    parent_hash: Optional[str] = None
    message_count: int
    summary: Optional[str] = None
    commit_type: str = "turn"
    agent_name: str
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class MemoryCommitDetail(MemoryCommitResponse):
    snapshot: Optional[dict] = None


class MemoryEntryResponse(BaseModel):
    id: int
    role: str
    content: str
    keywords: list[str] = []
    importance: float
    seq: int
    commit_id: Optional[int] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class RollbackRequest(BaseModel):
    commit_hash: str = Field(..., min_length=1)


class RecallResponse(BaseModel):
    query: str
    results: list[dict] = []


class RAGRetrieveRequest(BaseModel):
    query: str = Field(..., min_length=1)
    category: Optional[str] = None
    k: int = Field(default=5, ge=1, le=20)
