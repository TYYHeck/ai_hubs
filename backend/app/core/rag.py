# -*- coding: utf-8 -*-
"""
RAG 检索服务 — 零配置离线（基于数据集的关键词/BM25 检索）

设计：
  - 数据源：用户上传的数据集（DatasetRecord）。
  - 检索：对每条记录的字段文本做分词，使用 BM25 评分排序，返回 Top-K 相关片段。
  - 无需外部向量库 / embedding API，桌面端零配置可用；如未来接入向量库可在此替换。

记忆系统关联：Agent 开启 enable_rag 时，编排器会调用 retrieve() 将相关文档注入上下文，
配合 MemoryManager 的「长期记忆 + 近期窗口」形成多层上下文，减少幻觉。
"""

from __future__ import annotations

import math
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import create_session
from ..models.dataset import Dataset, DatasetRecord
from .tokenize import tokenize as _tokenize


def _record_text(record: DatasetRecord) -> str:
    """将一条数据集记录拼接为可检索文本。"""
    parts = []
    for v in (record.data or {}).values():
        if isinstance(v, (str, int, float)):
            parts.append(str(v))
    return " ".join(parts)


class RAGService:
    """RAG 检索（BM25，离线）"""

    async def retrieve(
        self,
        user_id: int,
        query: str,
        category: Optional[str] = None,
        k: int = 5,
        min_score: float = 0.0,
    ) -> list[dict]:
        """
        检索与 query 相关的数据集片段。

        返回: [{"dataset_id", "dataset_name", "record_id", "text", "score"}]
        """
        q_tokens = _tokenize(query)
        if not q_tokens:
            return []

        async with create_session() as session:
            # 取该用户（及可选分类）的数据集
            stmt = select(Dataset).where(Dataset.user_id == user_id)
            if category:
                stmt = stmt.where(Dataset.category == category)
            datasets = (await session.execute(stmt)).scalars().all()
            if not datasets:
                return []

            ds_ids = [d.id for d in datasets]
            ds_name = {d.id: d.name for d in datasets}

            rec_stmt = select(DatasetRecord).where(DatasetRecord.dataset_id.in_(ds_ids))
            records = (await session.execute(rec_stmt)).scalars().all()

        # 构建语料
        docs: list[list[str]] = []
        doc_meta: list[dict] = []
        for r in records:
            text = _record_text(r)
            toks = _tokenize(text)
            docs.append(toks)
            doc_meta.append(
                {"dataset_id": r.dataset_id, "dataset_name": ds_name.get(r.dataset_id, ""), "record_id": r.id, "text": text}
            )

        if not docs:
            return []

        # BM25
        N = len(docs)
        df: dict[str, int] = {}
        for d in docs:
            for t in set(d):
                df[t] = df.get(t, 0) + 1

        avgdl = sum(len(d) for d in docs) / max(N, 1)
        k1, b = 1.5, 0.75
        scores: list[tuple[float, int]] = []

        q_freq: dict[str, int] = {}
        for t in q_tokens:
            q_freq[t] = q_freq.get(t, 0) + 1

        for i, d in enumerate(docs):
            dl = len(d)
            if dl == 0:
                continue
            tf: dict[str, int] = {}
            for t in d:
                tf[t] = tf.get(t, 0) + 1
            score = 0.0
            for t, qf in q_freq.items():
                if t not in tf:
                    continue
                idf = math.log(1 + (N - df.get(t, 0) + 0.5) / (df.get(t, 0) + 0.5))
                denom = tf[t] + k1 * (1 - b + b * dl / max(avgdl, 1))
                score += idf * (tf[t] * (k1 + 1)) / denom * qf
            if score > min_score:
                scores.append((score, i))

        scores.sort(key=lambda x: -x[0])
        results = []
        for s, i in scores[:k]:
            meta = doc_meta[i]
            results.append(
                {
                    "dataset_id": meta["dataset_id"],
                    "dataset_name": meta["dataset_name"],
                    "record_id": meta["record_id"],
                    "text": meta["text"][:1000],
                    "score": round(s, 4),
                }
            )
        return results

    async def build_context(self, user_id: int, query: str, category: Optional[str] = None, k: int = 3) -> str:
        """将检索结果格式化为可注入 LLM 的上下文文本。"""
        hits = await self.retrieve(user_id, query, category=category, k=k)
        if not hits:
            return ""
        lines = ["以下是与问题相关的参考文档："]
        for i, h in enumerate(hits, 1):
            lines.append(f"[文档{i}｜{h['dataset_name']}] {h['text']}")
        return "\n".join(lines)


# 全局单例
rag_service = RAGService()
