# -*- coding: utf-8 -*-
"""RAG 向量切片模型 — 数据集记录的语义切片与向量存储"""

from __future__ import annotations
from datetime import datetime

from sqlalchemy import (
    Integer, String, Text, Float, JSON, DateTime, ForeignKey, Index,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RagChunk(Base):
    """RAG 切片表：每条数据集记录被切分为若干 chunk，各自存储向量。

    向量以 JSON 数组文本存储（MySQL 8.0 无原生向量类型，余弦相似度在 Python 侧计算），
    对 RAG 规模（单用户数据集通常为数千切片以内）性能与精度均足够，且零额外依赖。
    """

    __tablename__ = "rag_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    dataset_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    dataset_name: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(64), default="general", index=True)
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)

    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 向量：JSON 数组字符串；空串表示未向量化（仅 BM25 可用）
    embedding: Mapped[str] = mapped_column(Text, default="")
    token_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # 索引版本：数据集重索引时整体刷新，便于检测陈旧切片
    index_version: Mapped[int] = mapped_column(Integer, default=1)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "dataset_id": self.dataset_id,
            "dataset_name": self.dataset_name,
            "category": self.category,
            "record_id": self.record_id,
            "chunk_index": self.chunk_index,
            "content": self.content,
            "token_count": self.token_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# 复合索引：按数据集 + 记录快速定位切片（重索引时删除用）
Index(
    "ix_rag_chunks_ds_rec",
    RagChunk.dataset_id,
    RagChunk.record_id,
)
