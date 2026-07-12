# -*- coding: utf-8 -*-
"""知识库 Pydantic 模型 — 知识库 CRUD + 文档管理"""

from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    category: str = "general"
    embedding_provider: str = "openai"
    embedding_model: str = "text-embedding-3-small"
    chunk_size: int = 500
    chunk_overlap: int = 50
    top_k: int = 5


class KnowledgeBaseUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    category: Optional[str] = None
    embedding_provider: Optional[str] = None
    embedding_model: Optional[str] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    top_k: Optional[int] = None
    is_default: Optional[bool] = None


class KnowledgeBaseResponse(BaseModel):
    id: int
    name: str
    description: str
    category: str
    embedding_provider: str
    embedding_model: str
    chunk_size: int
    chunk_overlap: int
    top_k: int
    doc_count: int
    chunk_count: int
    is_default: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class KnowledgeDocResponse(BaseModel):
    id: int
    kb_id: int
    source_id: str
    name: str
    filename: str
    path: str
    size: int
    chunks: int
    file_type: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class KnowledgeSearchResult(BaseModel):
    text: str
    score: float
    source: str
    chunk_id: str
    doc_id: Optional[int] = None
