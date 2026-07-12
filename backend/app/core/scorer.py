# -*- coding: utf-8 -*-
"""
系统级质量评分器 QualityScorer（议题 #9④ / #7 Gate-2 复用）

把原先散落的「评审逻辑」抽成通用评分器，支持：
- 单 Agent 产出质量评分（相关性 / 完整性 / 是否偏离原始任务 / 可读性与无幻觉）
- 多 Agent 协作产出对比评分（用于 §15 效率测试板 / 回归）
- 结构化契约校验（与 §6 contracts 联动）

默认基于「规则 + 轻量 LLM」两档：
- 规则档（默认，零成本）：长度/任务关键词命中/是否含拒绝词/是否含有效结构。
- LLM 档（strict_mode 开启时）：调用 LLM 做语义级评分（0-10）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .llm import llm_manager

# 评分维度权重（规则档）
_WEIGHTS = {
    "relevance": 0.35,     # 相关性（任务关键词命中）
    "completeness": 0.25,  # 完整性（长度/结构）
    "on_task": 0.25,       # 是否偏离原始任务（拒绝词惩罚）
    "readability": 0.15,   # 可读性（段落/标题等）
}


@dataclass
class ScoreBreakdown:
    relevance: float = 0.0
    completeness: float = 0.0
    on_task: float = 0.0
    readability: float = 0.0
    total: float = 0.0
    passed: bool = True
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "relevance": round(self.relevance, 2),
            "completeness": round(self.completeness, 2),
            "on_task": round(self.on_task, 2),
            "readability": round(self.readability, 2),
            "total": round(self.total, 2),
            "passed": self.passed,
            "notes": self.notes,
        }


_REFUSAL_PATTERNS = [
    re.compile(r"我(无法|不能|不能帮|无法帮|没有能力|作为一个AI)", re.IGNORECASE),
    re.compile(r"i (can'?t|cannot|am unable|apologize)", re.IGNORECASE),
    re.compile(r"(抱歉|对不起)，?我(不能|无法|不能帮|不会)", re.IGNORECASE),
]


def _extract_keywords(text: str, limit: int = 12) -> list[str]:
    """抽取任务描述里的关键词（去掉停用词的中文/英文 token，保序去重）。"""
    stop = set("的 了 和 与 及 或 是 在 我 你 他 她 它 我们 你们 他们 一个 一种 请 如何 怎样 这个 那个 the a an of to and or is are be".split())
    toks = re.findall(r"[\w\u4e00-\u9fff]{2,}", (text or "").lower())
    seen: set[str] = set()
    out: list[str] = []
    for t in toks:
        if t not in stop and t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= limit:
            break
    return out


def score_rule(output: str, task: str, threshold: float = 6.0) -> ScoreBreakdown:
    """规则档评分（零成本）。返回 0-10 分及各维度。"""
    out = (output or "").strip()
    notes: list[str] = []

    # 完整性：长度信号
    length = len(out)
    if length < 30:
        completeness = 2.0
        notes.append("产出过短，可能未完成")
    elif length < 120:
        completeness = 5.0
    elif length < 600:
        completeness = 8.0
    else:
        completeness = 9.0

    # 相关性：任务关键词命中率
    kw = _extract_keywords(task)
    if kw:
        hit = sum(1 for k in kw if k in out.lower())
        relevance = min(10.0, 3.0 + (hit / max(1, len(kw))) * 7.0)
        if hit == 0:
            notes.append("产出未命中任何任务关键词")
    else:
        relevance = 6.0

    # 是否偏离任务：拒绝词惩罚
    on_task = 10.0
    for pat in _REFUSAL_PATTERNS:
        if pat.search(out):
            on_task = 3.0
            notes.append("产出含拒绝/无法完成的表述")
            break

    # 可读性：结构信号
    readability = 7.0
    if re.search(r"(^|\n)#{1,3} ", out):
        readability += 1.5
    if out.count("\n") >= 2:
        readability += 1.0
    readability = min(10.0, readability)

    total = (
        relevance * _WEIGHTS["relevance"]
        + completeness * _WEIGHTS["completeness"]
        + on_task * _WEIGHTS["on_task"]
        + readability * _WEIGHTS["readability"]
    )
    passed = total >= threshold
    if not passed:
        notes.append(f"总分 {total:.1f} 低于阈值 {threshold}")

    return ScoreBreakdown(relevance, completeness, on_task, readability, total, passed, notes)


async def score_llm(output: str, task: str, threshold: float = 6.0) -> ScoreBreakdown:
    """LLM 档评分（strict_mode 开启时使用，成本较高）。"""
    rule = score_rule(output, task, threshold)
    try:
        prompt = (
            "你是一个严格的质量评审专家。请对「AI Agent 的产出」按任务完成度打分（0-10）。\n"
            f"原始任务：\n{task[:800]}\n\n"
            f"Agent 产出：\n{output[:1500]}\n\n"
            "请只输出一个 JSON：{\"score\": <0-10 浮点数>, \"passed\": <true/false>, "
            "\"notes\": [\"最多两条简短点评\"]}。不要输出其他文字。"
        )
        resp = await llm_manager.chat(
            [{"role": "system", "content": "你是严谨的评审专家，只输出 JSON。"},
             {"role": "user", "content": prompt}],
            temperature=0,
        )
        import json
        m = re.search(r"\{.*\}", resp, re.DOTALL)
        if m:
            data = json.loads(m.group(0))
            total = float(data.get("score", rule.total))
            passed = bool(data.get("passed", total >= threshold))
            notes = list(data.get("notes", rule.notes))[:2]
            return ScoreBreakdown(
                relevance=rule.relevance, completeness=rule.completeness,
                on_task=rule.on_task, readability=rule.readability,
                total=total, passed=passed, notes=notes,
            )
    except Exception as e:
        import logging
        logging.getLogger("ai_hubs.scorer").warning(f"LLM 评分失败，回退规则档: {e}")
    return rule


async def score(output: str, task: str, *, strict: bool = False, threshold: float = 6.0) -> ScoreBreakdown:
    """统一入口：strict=True 走 LLM 档，否则规则档。"""
    if strict:
        return await score_llm(output, task, threshold)
    return score_rule(output, task, threshold)
