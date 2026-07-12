# -*- coding: utf-8 -*-
"""
效率指标采集器（议题 #15）— 速度 / 消耗 / 成本 的真实记录与聚合

与 §9 成本追踪共用采集层：每次任务执行落一条 BenchReport（进程内存储，
重启后清空；后续可替换为 DB 持久化）。提供：
- record_task：任务完成时记录一条报告
- list_reports / aggregate_by_mode：供效率测试板前端聚合展示

指标维度（§15.1）：
  速度 Speed：端到端延迟 latency_s
  消耗 Consumption：in/out token、cost_usd、API 调用（近似=agent 数×轮次）
  可靠性 Reliability：success
  协调效率 Coordination：rounds（协作模式实际轮次）
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("ai_hubs.metrics")

# 单价表：$ / 1K tokens（近似值，按模型子串匹配）。无匹配走 default。
_PRICING: dict[str, dict[str, float]] = {
    "deepseek-chat": {"in": 0.00014, "out": 0.00028},
    "deepseek-reasoner": {"in": 0.00055, "out": 0.00219},
    "gpt-4o": {"in": 0.005, "out": 0.015},
    "gpt-4o-mini": {"in": 0.00015, "out": 0.0006},
    "glm-4": {"in": 0.0005, "out": 0.0005},
    "qwen": {"in": 0.0004, "out": 0.0004},
    "default": {"in": 0.001, "out": 0.002},
}


def price_to_cost(model: str, in_tokens: int, out_tokens: int) -> float:
    """按模型估算 $ 成本（无精确单价时走 default 估算）。"""
    key = next((k for k in _PRICING if k != "default" and k in (model or "")), "default")
    p = _PRICING[key]
    return round(in_tokens / 1000 * p["in"] + out_tokens / 1000 * p["out"], 6)


@dataclass
class BenchReport:
    task_id: str
    user_id: int
    mode: str
    model: str
    agents: int
    latency_s: float
    in_tokens: int
    out_tokens: int
    cost_usd: float
    success: bool
    rounds: Optional[int] = None
    created_at: str = ""

    def as_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "mode": self.mode,
            "model": self.model,
            "agents": self.agents,
            "latency_s": round(self.latency_s, 2),
            "in_tokens": self.in_tokens,
            "out_tokens": self.out_tokens,
            "cost_usd": self.cost_usd,
            "success": self.success,
            "rounds": self.rounds,
            "created_at": self.created_at,
        }


_REPORTS: list[BenchReport] = []
_MAX_REPORTS = 1000


def record_task(
    *,
    task_id: str,
    user_id: int,
    mode: str,
    model: str,
    agents: int,
    latency_s: float,
    in_tokens: int,
    out_tokens: int,
    success: bool,
    rounds: Optional[int] = None,
) -> BenchReport:
    """记录一条任务效率报告。"""
    rep = BenchReport(
        task_id=task_id, user_id=user_id, mode=mode, model=model, agents=agents,
        latency_s=latency_s, in_tokens=in_tokens, out_tokens=out_tokens,
        cost_usd=price_to_cost(model, in_tokens, out_tokens),
        success=success, rounds=rounds,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    _REPORTS.append(rep)
    if len(_REPORTS) > _MAX_REPORTS:
        del _REPORTS[: len(_REPORTS) - _MAX_REPORTS]
    logger.info("效率报告: mode=%s agents=%d latency=%.1fs cost=$%.4f", mode, agents, latency_s, rep.cost_usd)
    return rep


def list_reports(limit: int = 100, mode: Optional[str] = None) -> list[dict]:
    reps = [r for r in _REPORTS if mode is None or r.mode == mode]
    reps = list(reversed(reps))[:limit]
    return [r.as_dict() for r in reps]


def aggregate_by_mode() -> list[dict]:
    """按模式聚合：平均延迟、平均成本、成功率、样本数。"""
    buckets: dict[str, list[BenchReport]] = {}
    for r in _REPORTS:
        buckets.setdefault(r.mode, []).append(r)
    out = []
    for mode, reps in buckets.items():
        n = len(reps)
        succ = sum(1 for r in reps if r.success)
        out.append({
            "mode": mode,
            "count": n,
            "success_rate": round(succ / n, 3),
            "avg_latency_s": round(sum(r.latency_s for r in reps) / n, 2),
            "avg_cost_usd": round(sum(r.cost_usd for r in reps) / n, 4),
            "avg_in_tokens": int(sum(r.in_tokens for r in reps) / n),
            "avg_out_tokens": int(sum(r.out_tokens for r in reps) / n),
            "avg_agents": round(sum(r.agents for r in reps) / n, 1),
            "avg_rounds": (round(sum(r.rounds for r in reps if r.rounds) / max(1, sum(1 for r in reps if r.rounds)), 1)
                            if any(r.rounds for r in reps) else None),
        })
    out.sort(key=lambda x: x["mode"])
    return out
