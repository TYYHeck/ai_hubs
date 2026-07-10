# -*- coding: utf-8 -*-
"""记忆管理路由 —— VCS版本控制 + 图谱 + 压缩"""

from __future__ import annotations
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/memory", tags=["记忆管理"])


class CommitRequest(BaseModel):
    message: str = Field("", description="提交说明")


class CheckoutRequest(BaseModel):
    commit_id: str = Field(..., description="目标 commit ID")


class DiffRequest(BaseModel):
    commit1: str = Field(..., description="基准版本")
    commit2: str = Field(..., description="对比版本")


class RecallRequest(BaseModel):
    query: str = Field(..., description="检索查询")
    n: int = Field(5, ge=1, le=20)


def _get_enhanced():
    """获取当前 Agent 的增强记忆"""
    from ..web_server import get_agent
    agent = get_agent()
    return agent.enhanced_memory if agent else None


@router.get("/vcs/log")
async def vcs_log(limit: int = Query(20, ge=1, le=100)):
    """获取版本提交历史 (git log)"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    commits = em.get_vcs_log()
    return {"ok": True, "commits": commits[-limit:], "total": len(commits)}


@router.post("/vcs/commit")
async def vcs_commit(req: CommitRequest = None):
    """手动创建记忆快照 (git commit)"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    message = req.message if req else ""
    commit_id = em.commit(message)
    if not commit_id:
        return {"ok": False, "error": "无消息可提交"}
    return {"ok": True, "commit_id": commit_id, "message": "快照已保存"}


@router.post("/vcs/checkout")
async def vcs_checkout(req: CheckoutRequest):
    """回退到指定版本 (git checkout)"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    success = em.checkout(req.commit_id)
    if not success:
        return {"ok": False, "error": "版本不存在"}
    return {"ok": True, "message": f"已回退到 {req.commit_id}"}


@router.post("/vcs/diff")
async def vcs_diff(req: DiffRequest):
    """对比两个版本差异 (git diff)"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    diff = em.get_vcs_diff(req.commit1, req.commit2)
    return {"ok": True, "diff": diff}


@router.get("/graph/visualize")
async def graph_visualize():
    """获取记忆图谱可视化数据"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    data = em.get_graph_data()
    return {"ok": True, "graph": data, "node_count": len(data["nodes"]), "edge_count": len(data["links"])}


@router.get("/graph/clusters")
async def graph_clusters():
    """获取记忆主题聚类"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    clusters = em.get_clusters()
    return {"ok": True, "clusters": clusters}


@router.post("/recall")
async def recall(req: RecallRequest):
    """双路检索：图谱 + 向量"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    result = em.recall(req.query, req.n)
    return {"ok": True, "result": result}


@router.post("/compress")
async def compress_history():
    """使用 LLM 高无损压缩对话历史"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}
    summary = em.compress_history()
    return {"ok": True, "summary": summary if summary else "无可压缩内容"}


@router.get("/stats")
async def memory_stats():
    """记忆系统统计信息"""
    em = _get_enhanced()
    if not em:
        return {"ok": False, "error": "增强记忆未初始化"}

    base = em.base
    return {
        "ok": True,
        "short_term": {
            "message_count": len(base.short) if base else 0,
            "max_turns": base.short.max_turns if base else 0,
        },
        "vcs": {
            "commit_count": em.vcs.commit_count,
            "head": em.vcs.head,
        },
        "graph": {
            "node_count": em.graph.node_count,
            "edge_count": em.graph.edge_count,
        },
    }
