# -*- coding: utf-8 -*-
"""
协作模式实现（议题 #8）— peer_review / round_table + 动态协调

替代原 v3 的 communication.py 四 Manager 轮询骨架，改为：
- 基于 Blackboard（§1）共享上下文
- 动态终止（chair/规则判断收敛）默认开启，省成本
- 复用 run_single 作为统一 Agent 执行入口

为避免与 orchestrator 循环依赖，run_single 采用函数内惰性导入。
"""

from __future__ import annotations

import difflib
import logging

from .blackboard import get_blackboard, drop_blackboard

logger = logging.getLogger("ai_hubs.collab")

# 动态终止默认参数
MIN_ROUNDS = 1
MAX_ROUNDS = 4


def _converged(prev: str, cur: str, threshold: float = 0.85) -> bool:
    """轻量收敛检测：两轮小结文本相似度过高 → 视为已达成共识。"""
    if not prev or not cur:
        return False
    ratio = difflib.SequenceMatcher(None, prev, cur).ratio()
    return ratio >= threshold


async def run_peer_review(
    task_id: str,
    agents: list,
    user_input: str,
    event_queue,
    user_id: int,
    rounds: int = 1,
) -> str:
    """同行评审模式：各 Agent 出初稿 → 评审者逐一点评 → 作者修订 → 汇总终稿。"""
    from .orchestrator import run_single
    from .orchestrator import _emit_event

    board = get_blackboard(task_id, "peer_review")
    for a in agents:
        board.join_participant(a.name)

    await _emit_event(None, task_id, "peer_review_start",
                      {"agents": [a.name for a in agents], "rounds": rounds},
                      event_queue=event_queue)

    # 初稿
    drafts: dict[str, str] = {}
    for a in agents:
        out = await run_single(
            task_id, a,
            f"请就以下任务独立产出你的方案/回答（尽量结构化、可评审）：\n{user_input}",
            event_queue, user_id,
        )
        drafts[a.name] = out
        board.write_private(a.name, "draft", out)

    reviewer = agents[0]
    for r in range(rounds):
        combined = "\n\n---\n\n".join(f"**{name}**:\n{d}" for name, d in drafts.items())
        review = await run_single(
            task_id, reviewer,
            f"任务：{user_input}\n\n以下是几位 Agent 的初稿，请逐一点评（优点/问题/改进建议），"
            f"并给出综合最佳版本：\n{combined}",
            event_queue, user_id,
        )
        board.write_public(reviewer.name, f"review_{r}", review)
        await _emit_event(None, task_id, "peer_review_round",
                          {"round": r + 1, "reviewer": reviewer.name},
                          event_queue=event_queue)

        # 作者据评审修订
        for a in agents:
            rev_prompt = (
                f"任务：{user_input}\n\n你的初稿：\n{drafts[a.name]}\n\n"
                f"评审意见：\n{review}\n\n请据此修订你的方案（保留优点、修正问题）。"
            )
            drafts[a.name] = await run_single(task_id, a, rev_prompt, event_queue, user_id)
            board.write_private(a.name, f"draft_r{r}", drafts[a.name])

    final = "\n\n---\n\n".join(f"**{name}（终稿）**:\n{d}" for name, d in drafts.items())
    return final


async def run_round_table(
    task_id: str,
    agents: list,
    user_input: str,
    event_queue,
    user_id: int,
    rounds: int = 2,
    dynamic: bool = True,
) -> str:
    """圆桌讨论模式：主持人引导 + 参与者轮流发言，动态收敛提前结束。"""
    from .orchestrator import run_single
    from .orchestrator import _emit_event

    board = get_blackboard(task_id, "round_table")
    for a in agents:
        board.join_participant(a.name)
    moderator = agents[0]

    await _emit_event(None, task_id, "round_table_start",
                      {"agents": [a.name for a in agents], "max_rounds": rounds, "dynamic": dynamic},
                      event_queue=event_queue)

    prev_summary = ""
    actual_rounds = 0
    for rnd in range(1, MAX_ROUNDS + 1):
        if rnd > rounds:
            break
        actual_rounds = rnd
        await _emit_event(None, task_id, "round_table_round",
                          {"round": rnd, "total": rounds},
                          event_queue=event_queue)
        public_ctx = board.read_public()
        ctx_text = "\n\n".join(f"**{k}**: {v}" for k, v in public_ctx.items()) if public_ctx else "（暂无）"
        for a in agents:
            prompt = (
                f"圆桌议题：{user_input}\n\n已有讨论记录：\n{ctx_text}\n\n"
                f"请作为参与者「{a.name}」发言，补充新观点或回应他人，避免重复已有内容。"
            )
            out = await run_single(task_id, a, prompt, event_queue, user_id)
            board.write_public(a.name, f"round_{rnd}_{a.name}", out)

        summary = await run_single(
            task_id, moderator,
            f"议题：{user_input}\n\n本轮发言：\n{ctx_text}\n\n"
            f"请总结本轮达成的共识与仍存在的分歧（简洁）。",
            event_queue, user_id,
        )
        board.write_public(moderator.name, f"summary_{rnd}", summary)

        if dynamic and rnd >= MIN_ROUNDS and _converged(prev_summary, summary):
            await _emit_event(None, task_id, "round_table_converged",
                              {"round": rnd, "reason": "讨论已收敛，提前结束"},
                              event_queue=event_queue)
            break
        prev_summary = summary

    fin = board.finalize()
    summary_text = "\n\n".join(f"- {k}: {v}" for k, v in fin["public"].items())
    return f"## 圆桌讨论结果（{actual_rounds} 轮）\n\n{summary_text}"
