# -*- coding: utf-8 -*-
"""效率测试板 API（议题 #15）— 速度 / 消耗 / 成本 / 协调效率 的聚合查询"""

from fastapi import APIRouter, Query, Depends

from ...core.metrics_collector import list_reports, aggregate_by_mode
from ..deps import get_current_user

router = APIRouter(prefix="/efficiency", tags=["Efficiency"])


@router.get("/reports")
async def api_list_reports(
    limit: int = Query(100, ge=1, le=1000),
    mode: str | None = Query(None),
    current_user=Depends(get_current_user),
):
    """最近的任务效率报告列表（速度/消耗/成本/协调轮次）。"""
    return list_reports(limit=limit, mode=mode)


@router.get("/summary")
async def api_summary(current_user=Depends(get_current_user)):
    """按模式聚合的效率画像（用于效率测试板对比表/排行榜）。"""
    return aggregate_by_mode()
