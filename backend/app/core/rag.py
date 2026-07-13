# -*- coding: utf-8 -*-
"""
RAG 检索服务 — 语义向量 + BM25 混合检索（最高质量、可降级）

设计：
  - 数据源：用户上传的数据集（DatasetRecord）。
  - 切片：每条记录按「重叠滑动窗口」切分为语义片段（chunk），而非整条记录，
          解决长记录信息被稀释、短查询无法精确定位的问题。
  - 向量化：通过 OpenAI 兼容 /embeddings 端点生成 chunk 向量，存于 rag_chunks 表。
  - 检索：向量余弦相似度（语义）与 BM25（关键词）做「加权融合」混合召回，
          向量不可用时自动降级为纯 BM25，保证零配置仍可用。
  - 重索引：数据集记录增删改时调用 reindex_dataset；首次检索若用户有数据集但无切片则惰性建索引。

记忆系统关联：Agent 开启 enable_rag 时，编排器调用 build_context() 将相关片段注入上下文，
配合 MemoryManager 的「长期记忆 + 近期窗口」形成多层上下文，减少幻觉。

公开接口与旧版兼容：retrieve(...) / build_context(...)，调用方（orchestrator / chat）无需改动。
"""

from __future__ import annotations

import json
import math
from typing import Optional

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import create_session
from ..models.dataset import Dataset, DatasetRecord
from ..models.rag_chunk import RagChunk
from .tokenize import tokenize as _tokenize
from .embeddings import embed_texts, embed_query, cosine, EmbeddingError


# ── 切片参数 ──
_CHUNK_MAX_CHARS = 700
_CHUNK_OVERLAP = 120
# 混合检索中向量召回的权重（其余归 BM25）
_VECTOR_WEIGHT = 0.7


def _record_text(record: DatasetRecord) -> str:
    """将一条数据集记录拼接为可检索文本。"""
    parts = []
    for v in (record.data or {}).values():
        if isinstance(v, (str, int, float)):
            parts.append(str(v))
    return " ".join(parts)


def _chunk_text(text: str, max_chars: int = _CHUNK_MAX_CHARS, overlap: int = _CHUNK_OVERLAP) -> list[str]:
    """将长文本按重叠滑动窗口切分为片段。

    长度不超过 max_chars 的整体作为一段；否则按窗口滑动、相邻窗口重叠 overlap 字符，
    避免跨窗口的句子被截断导致语义分裂。
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    start = 0
    step = max(1, max_chars - overlap)
    while start < len(text):
        end = min(start + max_chars, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start += step
    return chunks


def _parse_embedding(raw: str) -> Optional[list[float]]:
    """从 rag_chunks.embedding（JSON 数组文本）还原向量。"""
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _bm25_scores(docs: list[list[str]], q_tokens: list[str]) -> list[float]:
    """对语料 docs（已分词）按查询 q_tokens 计算 BM25 分数（纯函数，可测试）。"""
    if not docs or not q_tokens:
        return [0.0] * len(docs)

    N = len(docs)
    df: dict[str, int] = {}
    for d in docs:
        for t in set(d):
            df[t] = df.get(t, 0) + 1

    avgdl = sum(len(d) for d in docs) / max(N, 1)
    k1, b = 1.5, 0.75

    q_freq: dict[str, int] = {}
    for t in q_tokens:
        q_freq[t] = q_freq.get(t, 0) + 1

    scores: list[float] = []
    for d in docs:
        dl = len(d)
        if dl == 0:
            scores.append(0.0)
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
        scores.append(score)
    return scores


def _normalize(scores: list[float]) -> list[float]:
    """min-max 归一化到 [0,1]；全相等时置 1.0（避免零化后丢失排序信息）。"""
    if not scores:
        return []
    lo, hi = min(scores), max(scores)
    if hi == lo:
        return [1.0] * len(scores)
    return [(s - lo) / (hi - lo) for s in scores]


def _hybrid_fusion(bm25: list[float], vec: list[float], alpha: float = _VECTOR_WEIGHT) -> list[float]:
    """加权融合归一化后的 BM25 与向量分数。"""
    n_bm25 = _normalize(bm25)
    n_vec = _normalize(vec)
    return [alpha * v + (1 - alpha) * b for v, b in zip(n_vec, n_bm25)]


class RAGService:
    """RAG 检索（语义向量 + BM25 混合，可降级）"""

    # ───────────────────────── 检索 ─────────────────────────

    async def retrieve(
        self,
        user_id: int,
        query: str,
        category: Optional[str] = None,
        k: int = 5,
        min_score: float = 0.0,
    ) -> list[dict]:
        """
        检索与 query 相关的数据集片段（混合召回）。

        返回: [{"dataset_id","dataset_name","record_id","chunk_index","text","score","score_bm25","score_vec"}]
        """
        q_tokens = _tokenize(query)
        if not q_tokens:
            return []

        # 惰性建索引：用户有数据集但尚无切片时一次性补齐
        await self._ensure_indexed(user_id)

        async with create_session() as session:
            stmt = select(RagChunk).where(RagChunk.user_id == user_id)
            if category:
                stmt = stmt.where(RagChunk.category == category)
            chunks = (await session.execute(stmt)).scalars().all()

        if not chunks:
            return []

        docs = [_tokenize(c.content) for c in chunks]
        bm25 = _bm25_scores(docs, q_tokens)

        # 向量召回（best-effort，失败即降级）
        vec_scores = [0.0] * len(chunks)
        vec_available = False
        try:
            qvec = await embed_query(query)
            vec_available = True
            for i, c in enumerate(chunks):
                emb = _parse_embedding(c.embedding)
                if emb:
                    vec_scores[i] = cosine(emb, qvec)
        except EmbeddingError:
            logger = __import__("logging").getLogger("ai_hubs.rag")
            logger.info("embedding 未启用/未配置，RAG 回退纯 BM25")
        except Exception as e:
            logger = __import__("logging").getLogger("ai_hubs.rag")
            logger.warning(f"向量检索失败，回退 BM25: {e}")

        fused = _hybrid_fusion(bm25, vec_scores) if vec_available else bm25

        ranked = sorted(range(len(chunks)), key=lambda i: -fused[i])
        results: list[dict] = []
        for i in ranked:
            s = fused[i]
            if s <= min_score:
                continue
            c = chunks[i]
            results.append({
                "dataset_id": c.dataset_id,
                "dataset_name": c.dataset_name,
                "record_id": c.record_id,
                "chunk_index": c.chunk_index,
                "text": c.content[:1500],
                "score": round(s, 4),
                "score_bm25": round(bm25[i], 4),
                "score_vec": round(vec_scores[i], 4),
            })
            if len(results) >= k:
                break
        return results

    async def build_context(self, user_id: int, query: str, category: Optional[str] = None, k: int = 3) -> str:
        """将检索结果格式化为可注入 LLM 的上下文文本（接口兼容旧版）。"""
        hits = await self.retrieve(user_id, query, category=category, k=k)
        if not hits:
            return ""
        lines = ["以下是与问题相关的参考文档："]
        for i, h in enumerate(hits, 1):
            src = f"{h['dataset_name']}#记录{h['record_id']}"
            lines.append(f"[文档{i}｜{src}] {h['text']}")
        return "\n".join(lines)

    # ───────────────────────── 索引管理 ─────────────────────────

    async def _ensure_indexed(self, user_id: int) -> None:
        """若用户有数据集但尚无任何切片，惰性全量建索引。"""
        async with create_session() as session:
            cnt = (await session.execute(
                select(func.count()).select_from(RagChunk).where(RagChunk.user_id == user_id)
            )).scalar_one()
            if cnt and cnt > 0:
                return
            ds = (await session.execute(
                select(Dataset).where(Dataset.user_id == user_id)
            )).scalars().all()
            if not ds:
                return
        await self.reindex_user(user_id)

    async def reindex_dataset(self, dataset_id: int) -> int:
        """（重）索引单个数据集：删除旧切片 → 切分 → 向量化 → 写入。返回切片数。"""
        async with create_session() as session:
            ds = await session.get(Dataset, dataset_id)
            if ds is None:
                return 0
            user_id = ds.user_id

            # 删除该数据集旧切片
            await session.execute(delete(RagChunk).where(RagChunk.dataset_id == dataset_id))

            recs = (await session.execute(
                select(DatasetRecord).where(DatasetRecord.dataset_id == dataset_id)
            )).scalars().all()

            texts: list[str] = []
            meta: list[tuple[int, int]] = []
            for r in recs:
                t = _record_text(r)
                for ci, chunk in enumerate(_chunk_text(t)):
                    texts.append(chunk)
                    meta.append((r.id, ci))

            # 向量化（best-effort）
            embeddings: list[Optional[str]] = [None] * len(texts)
            if texts:
                try:
                    vecs = await embed_texts(texts)
                    embeddings = [json.dumps(v, ensure_ascii=False) for v in vecs]
                except EmbeddingError:
                    __import__("logging").getLogger("ai_hubs.rag").info(
                        "embedding 未启用，数据集 %s 仅建 BM25 切片", dataset_id
                    )
                except Exception as e:
                    __import__("logging").getLogger("ai_hubs.rag").warning(
                        f"数据集 {dataset_id} 向量化失败: {e}"
                    )

            for text, (record_id, ci), emb in zip(texts, meta, embeddings):
                session.add(RagChunk(
                    user_id=user_id,
                    dataset_id=dataset_id,
                    dataset_name=ds.name,
                    category=ds.category,
                    record_id=record_id,
                    chunk_index=ci,
                    content=text,
                    embedding=emb or "",
                    token_count=len(_tokenize(text)),
                ))
            await session.commit()
            return len(texts)

    async def reindex_user(self, user_id: int) -> int:
        """重索引用户所有数据集，返回数据集数。"""
        async with create_session() as session:
            ds = (await session.execute(
                select(Dataset).where(Dataset.user_id == user_id)
            )).scalars().all()
        total = 0
        for d in ds:
            total += await self.reindex_dataset(d.id)
        return total

    async def delete_dataset_chunks(self, dataset_id: int) -> None:
        """删除某数据集的全部切片（数据集被删除时调用）。"""
        async with create_session() as session:
            await session.execute(delete(RagChunk).where(RagChunk.dataset_id == dataset_id))
            await session.commit()


# 全局单例
rag_service = RAGService()
