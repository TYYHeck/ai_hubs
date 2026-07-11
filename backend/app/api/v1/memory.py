# -*- coding: utf-8 -*-
"""记忆系统 API — commits / rollback / recall / context / rag

所有端点均限定当前登录用户（user_id），agent_name 默认 "default"。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...core.memory import memory_manager
from ...core.rag import rag_service
from ...models.user import User
from ..deps import get_current_user
from ...schemas.memory import (
    MemoryCommitResponse,
    MemoryCommitDetail,
    RollbackRequest,
    RAGRetrieveRequest,
)

router = APIRouter(prefix="/memory", tags=["Memory"])


@router.get("/commits")
async def list_commits(
    agent: str = "default",
    limit: int = 50,
    current_user: User = Depends(get_current_user),
):
    """列出某 Agent 的记忆提交历史（git 式）。"""
    commits = await memory_manager.list_commits(current_user.id, agent, limit=limit)
    return {"agent": agent, "commits": commits}


@router.get("/commits/{commit_hash}")
async def get_commit(
    commit_hash: str,
    agent: str = "default",
    current_user: User = Depends(get_current_user),
):
    """查看某次提交详情（含快照）。"""
    commit = await memory_manager.get_commit(current_user.id, commit_hash)
    if not commit:
        raise HTTPException(status_code=404, detail="提交不存在")
    return commit


@router.post("/rollback")
async def rollback(
    body: RollbackRequest,
    agent: str = "default",
    current_user: User = Depends(get_current_user),
):
    """回退到指定 commit（git reset 式，保留历史记录）。"""
    try:
        result = await memory_manager.rollback(current_user.id, agent, body.commit_hash)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "commit": result}


@router.get("/recall")
async def recall(
    query: str,
    agent: str = "default",
    k: int = 6,
    current_user: User = Depends(get_current_user),
):
    """关键词检索相关记忆（记忆图谱检索）。"""
    results = await memory_manager.recall(current_user.id, agent, query, k=k)
    return {"query": query, "results": results}


@router.get("/context")
async def get_context(
    agent: str = "default",
    query: str = "",
    memory_strength: float = 3.0,
    token_budget: int = 3000,
    current_user: User = Depends(get_current_user),
):
    """构建当前记忆上下文（供调试/前端预览）。"""
    ctx = await memory_manager.build_context(
        current_user.id,
        agent,
        query=query or None,
        memory_strength=memory_strength,
        token_budget=token_budget,
    )
    return {"agent": agent, "context": ctx}


@router.get("/stats")
async def get_stats(
    agent: str = "default",
    current_user: User = Depends(get_current_user),
):
    """记忆统计。"""
    return await memory_manager.get_stats(current_user.id, agent)


@router.post("/compress")
async def compress(
    agent: str = "default",
    current_user: User = Depends(get_current_user),
):
    """手动触发记忆压缩。"""
    result = await memory_manager.compress_now(current_user.id, agent)
    return {"ok": True, "commit": result}


@router.post("/rag/retrieve")
async def rag_retrieve(
    body: RAGRetrieveRequest,
    current_user: User = Depends(get_current_user),
):
    """RAG 检索：基于用户数据集的关键词/BM25 检索。"""
    results = await rag_service.retrieve(
        current_user.id, body.query, category=body.category, k=body.k
    )
    return {"query": body.query, "results": results}
