# -*- coding: utf-8 -*-
"""
Embedding 服务 — OpenAI 兼容 /embeddings 端点（异步）

设计目标（最高质量、可降级）：
  - 兼容任意 OpenAI 格式 embedding 端点（OpenAI / 智谱 / 本地 vLLM / Ollama 等）。
  - 配置独立：从 llm_config.json 的 `embedding` 段读取（与对话 LLM 解耦，
    允许「对话用 DeepSeek、向量用 OpenAI」）。
  - 维度探测：首次请求自动探测并缓存向量维度。
  - 批处理 + 并发限制 + 指数退避重试，避免大批量 indexing 触发限流。
  - 进程内 LRU 缓存：相同文本不重复请求，降低费用与延迟。
  - 降级：未启用 / 未配置 key / API 失败时抛出 EmbeddingError，调用方回退 BM25。

注意：本模块不依赖具体向量库，仅产出向量；存储与检索在 core/rag.py 的向量层完成。
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Optional

from openai import AsyncOpenAI

from .llm import get_embedding_config

logger = logging.getLogger("ai_hubs.embeddings")

# ── 并发与批处理参数 ──
_MAX_CONCURRENCY = 4
_BATCH_SIZE = 24
_MAX_RETRIES = 3
_RETRY_BACKOFF = 0.6  # 秒，指数退避基数

# ── 进程内缓存（key=文本 sha256）──
_EMBED_CACHE: dict[str, list[float]] = {}
_CACHE_LIMIT = 20000

# 向量维度（首次探测后缓存）
_DIMENSION: Optional[int] = None

# 客户端缓存（按 base_url+api_key 复用）
_CLIENT: Optional[AsyncOpenAI] = None
_CLIENT_KEY: Optional[tuple] = None


class EmbeddingError(Exception):
    """Embedding 不可用（未启用 / 未配置 / API 失败）。调用方应回退到 BM25。"""


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def get_dimension() -> Optional[int]:
    """返回已探测到的向量维度（未探测过则为 None）。"""
    return _DIMENSION


def cosine(a: list[float], b: list[float]) -> float:
    """余弦相似度，带零向量保护。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    denom = (na ** 0.5) * (nb ** 0.5)
    if denom == 0.0:
        return 0.0
    return dot / denom


def _get_client(base_url: str, api_key: str) -> AsyncOpenAI:
    global _CLIENT, _CLIENT_KEY
    key = (base_url, api_key)
    if _CLIENT is None or _CLIENT_KEY != key:
        _CLIENT = AsyncOpenAI(api_key=api_key, base_url=base_url)
        _CLIENT_KEY = key
    return _CLIENT


async def _embed_once(client: AsyncOpenAI, model: str, batch: list[str]) -> list[list[float]]:
    """单次批量 embed（带重试）。"""
    last_err: Optional[Exception] = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = await client.embeddings.create(model=model, input=batch)
            vecs = [list(d.embedding) for d in resp.data]
            # 顺序对齐（API 按输入顺序返回）
            if len(vecs) != len(batch):
                raise EmbeddingError(f"embedding 返回数量不匹配: {len(vecs)} != {len(batch)}")
            return vecs
        except Exception as e:  # 限流 / 网络 / 4xx
            last_err = e
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_RETRY_BACKOFF * (2 ** attempt))
            else:
                raise EmbeddingError(f"embedding API 失败: {type(e).__name__}: {e}") from e
    # 理论不可达
    raise EmbeddingError(f"embedding 失败: {last_err}")


async def embed_texts(texts: list[str], *, use_cache: bool = True) -> list[list[float]]:
    """批量将文本转换为向量。

    - 自动去重 + 进程内缓存命中跳过请求。
    - 返回长度与输入一致（保持顺序），缓存命中项直接取缓存。
    - 未启用 / 无 key → 抛 EmbeddingError（调用方回退 BM25）。
    """
    global _DIMENSION
    cfg = get_embedding_config()
    if not cfg.get("enabled"):
        raise EmbeddingError("embedding 未启用（llm_config.json 未配置 embedding.enabled=true）")
    if not cfg.get("api_key"):
        raise EmbeddingError("embedding 未配置 api_key")

    client = _get_client(cfg["base_url"], cfg["api_key"])
    model = cfg["model"]

    # 去重并分离缓存命中
    ordered = list(dict.fromkeys(texts))
    to_embed: list[str] = []
    cache_hit: dict[str, list[float]] = {}
    for t in ordered:
        h = _hash(t)
        if use_cache and h in _EMBED_CACHE:
            cache_hit[t] = _EMBED_CACHE[h]
        else:
            to_embed.append(t)

    if to_embed:
        sem = asyncio.Semaphore(_MAX_CONCURRENCY)

        async def _batch(batch: list[str]) -> list[list[float]]:
            async with sem:
                return await _embed_once(client, model, batch)

        batches = [to_embed[i : i + _BATCH_SIZE] for i in range(0, len(to_embed), _BATCH_SIZE)]
        results = await asyncio.gather(*[_batch(b) for b in batches])

        idx = 0
        for b in batches:
            vecs = results[idx]
            idx += 1
            for t, vec in zip(b, vecs):
                if _DIMENSION is None:
                    _DIMENSION = len(vec)
                if use_cache:
                    if len(_EMBED_CACHE) >= _CACHE_LIMIT:
                        # 简单 FIFO 淘汰
                        _EMBED_CACHE.pop(next(iter(_EMBED_CACHE)))
                    _EMBED_CACHE[_hash(t)] = vec
                cache_hit[t] = vec

    return [cache_hit[t] for t in texts]


async def embed_query(text: str) -> list[float]:
    """嵌入单条查询（供检索使用，带缓存）。"""
    vecs = await embed_texts([text])
    return vecs[0]


def clear_cache() -> None:
    """清空进程内 embedding 缓存（测试 / 配置变更时调用）。"""
    _EMBED_CACHE.clear()
