# -*- coding: utf-8 -*-
"""
任务编排器 — 8 种 Agent 协作模式

模式说明:
  single       — 单个 Agent 独立执行
  sequential   — Agent 依次串行，前一个输出作为后一个的上下文
  parallel     — 多个 Agent 同时执行，汇总结果
  debate       — Agent 辩论：各自给出观点 → 交叉质疑 → 综合
  vote         — 各 Agent 投票，多数决议
  hierarchical — 主管 Agent 分解任务 → 委派给工作 Agent → 汇总
  swarm        — Agent 自组织协作（共享上下文，自选子任务）
  custom       — 用户自定义流水线
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from ..database import create_session
from ..models.agent import Agent as AgentModel
from ..models.task import Task as TaskModel, TaskEvent as TaskEventModel
from .llm import llm_manager
from ..config import settings

logger = logging.getLogger("ai_hubs.orchestrator")

# 运行中的任务（内存跟踪，支持暂停/恢复）
_active_tasks: dict[str, asyncio.Event] = {}  # task_id -> pause_event


def get_pause_event(task_id: str) -> asyncio.Event:
    """获取任务的暂停事件（不存在则创建）"""
    if task_id not in _active_tasks:
        _active_tasks[task_id] = asyncio.Event()
        _active_tasks[task_id].set()  # 初始不暂停
    return _active_tasks[task_id]


async def _emit_event(session, task_id: str, event: str, data: dict = None, *, event_queue: asyncio.Queue = None):
    """记录事件到 DB 并推送到 SSE 队列"""
    tz = timezone.utc
    evt = TaskEventModel(
        task_id=task_id,
        event=event,
        data=data or {},
    )
    # 手动设时间避免 sqlite 默认值问题
    evt.created_at = datetime.now(tz).replace(tzinfo=None)
    session.add(evt)
    await session.commit()

    if event_queue is not None:
        payload = {
            "time": evt.created_at.isoformat(timespec="seconds"),
            "event": event,
            "data": data or {},
        }
        await event_queue.put(payload)


async def _update_task_status(session, task_id: str, status: str, **kwargs):
    """更新任务状态"""
    task = await session.get(TaskModel, task_id)
    if task:
        task.status = status
        for k, v in kwargs.items():
            setattr(task, k, v)
        await session.commit()


# ============================================================
# 8 种编排模式
# ============================================================

async def run_single(
    task_id: str,
    agent: AgentModel,
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
) -> str:
    """单 Agent 模式"""
    pause_evt = get_pause_event(task_id)
    await pause_evt.wait()

    messages = [
        {"role": "system", "content": agent.system_prompt or "你是一个 AI 助手。"},
        {"role": "user", "content": user_input},
    ]

    await _emit_event(None, task_id, "agent_start",
                      {"agent": agent.name, "provider": agent.provider, "model": agent.model},
                      event_queue=event_queue)

    full = []
    try:
        async for chunk in llm_manager.stream_chat(
            messages,
            model=agent.model,
        ):
            await pause_evt.wait()  # 暂停检查
            full.append(chunk)

        result = "".join(full)
        await _emit_event(None, task_id, "agent_done",
                          {"agent": agent.name, "length": len(result)},
                          event_queue=event_queue)
        return result
    except Exception as e:
        await _emit_event(None, task_id, "agent_error",
                          {"agent": agent.name, "error": str(e)},
                          event_queue=event_queue)
        raise


async def run_sequential(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
) -> str:
    """串行模式：Agent 1 → Agent 2 → ... 每个收到前一个的输出"""
    context = user_input
    results = []

    for i, agent in enumerate(agents):
        await _emit_event(None, task_id, "sequential_step",
                          {"step": i + 1, "total": len(agents), "agent": agent.name},
                          event_queue=event_queue)

        if i > 0:
            prompt = f"前一步 Agent 的输出：\n{context}\n\n请基于以上输出继续处理：{user_input}"
        else:
            prompt = context

        try:
            step_result = await run_single(task_id, agent, prompt, event_queue, user_id)
            context = step_result
            results.append({"agent": agent.name, "output": step_result})
        except Exception:
            raise

    return "\n\n---\n\n".join(r["output"] for r in results)


async def run_parallel(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
) -> str:
    """并行模式：全部 Agent 同时执行，汇总结果"""
    await _emit_event(None, task_id, "parallel_start",
                      {"agents": [a.name for a in agents]},
                      event_queue=event_queue)

    async def _run_one(agent: AgentModel) -> dict:
        try:
            out = await run_single(task_id, agent, user_input, event_queue, user_id)
            return {"agent": agent.name, "output": out}
        except Exception as e:
            return {"agent": agent.name, "error": str(e)}

    results = await asyncio.gather(*[_run_one(a) for a in agents])

    await _emit_event(None, task_id, "parallel_done",
                      {"count": len(results)},
                      event_queue=event_queue)

    parts = []
    for r in results:
        if "error" in r:
            parts.append(f"**[{r['agent']}]**\n错误: {r['error']}")
        else:
            parts.append(f"**[{r['agent']}]**\n{r['output']}")
    return "\n\n---\n\n".join(parts)


async def run_debate(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
    rounds: int = 2,
) -> str:
    """辩论模式：各 Agent 给出观点 → 互相质疑 → 综合结论"""
    await _emit_event(None, task_id, "debate_start",
                      {"agents": [a.name for a in agents], "rounds": rounds},
                      event_queue=event_queue)

    # 第 1 轮：各自给出初始观点
    opinions = {}
    for agent in agents:
        prompt = f"议题：{user_input}\n\n请给出你的分析观点。"
        out = await run_single(task_id, agent, prompt, event_queue, user_id)
        opinions[agent.name] = out

    # 第 2+ 轮：互相看到对方观点后补充/质疑
    for rnd in range(1, rounds):
        await _emit_event(None, task_id, "debate_round",
                          {"round": rnd + 1, "total": rounds},
                          event_queue=event_queue)
        new_opinions = {}
        for agent in agents:
            others = "\n\n".join(f"**{name}**: {op}" for name, op in opinions.items() if name != agent.name)
            prompt = (f"议题：{user_input}\n\n"
                      f"其他 Agent 的观点：\n{others}\n\n"
                      f"请给出你的回应：是否同意？有何补充或质疑？")
            out = await run_single(task_id, agent, prompt, event_queue, user_id)
            new_opinions[agent.name] = out
        opinions = new_opinions

    # 综合——让第一个 Agent 汇总
    all_ops = "\n\n---\n\n".join(f"**{name}**:\n{op}" for name, op in opinions.items())
    synthesis_prompt = (f"议题：{user_input}\n\n"
                        f"以下是 {len(agents)} 个 Agent 经过 {rounds} 轮辩论的最终观点：\n{all_ops}\n\n"
                        f"请综合各方观点，给出一个全面的结论，标注共识和分歧。")
    result = await run_single(task_id, agents[0], synthesis_prompt, event_queue, user_id)
    return result


async def run_vote(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
) -> str:
    """投票模式：各 Agent 给出决策 → 统计多数"""
    await _emit_event(None, task_id, "vote_start",
                      {"agents": [a.name for a in agents]},
                      event_queue=event_queue)

    votes = {}
    for agent in agents:
        prompt = f"{user_input}\n\n请选择一个明确选项并简要说明理由。格式：选项: XXX\n理由: XXX"
        out = await run_single(task_id, agent, prompt, event_queue, user_id)
        votes[agent.name] = out

    # 汇总投票结果
    result_lines = ["## 投票结果\n"]
    for i, (name, vote) in enumerate(votes.items()):
        result_lines.append(f"### {name}")
        result_lines.append(vote.strip())
        result_lines.append("")
    result_lines.append(f"共 {len(agents)} 位 Agent 参与投票。")
    return "\n".join(result_lines)


async def run_hierarchical(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
) -> str:
    """层级模式：第 1 个 Agent 是主管，其余是工作者"""
    if len(agents) < 2:
        return await run_single(task_id, agents[0], user_input, event_queue, user_id)

    manager = agents[0]
    workers = agents[1:]

    await _emit_event(None, task_id, "hierarchical_plan",
                      {"manager": manager.name, "workers": [w.name for w in workers]},
                      event_queue=event_queue)

    # 主管分解任务
    plan_prompt = (f"任务：{user_input}\n\n"
                   f"你是项目主管。你的团队有 {len(workers)} 名成员：{', '.join(w.name for w in workers)}。\n"
                   f"请将任务分解为 {len(workers)} 个子任务，每个分配给一名成员。\n"
                   f"输出格式：\n"
                   f"1. [成员名] 子任务描述\n"
                   f"2. [成员名] 子任务描述\n"
                   f"...")
    plan = await run_single(task_id, manager, plan_prompt, event_queue, user_id)

    await _emit_event(None, task_id, "hierarchical_delegate",
                      {"plan_summary": plan[:300]},
                      event_queue=event_queue)

    # 工作者并行执行各自的子任务
    async def _worker(w: AgentModel, idx: int):
        sub_prompt = f"主管分解的子任务（第 {idx + 1} 项）：\n{plan}\n\n请完成分配给你的部分。"
        return {"agent": w.name, "output": await run_single(task_id, w, sub_prompt, event_queue, user_id)}

    worker_results = await asyncio.gather(*[_worker(w, i) for i, w in enumerate(workers)])

    # 主管汇总
    all_results = "\n\n---\n\n".join(f"**{r['agent']}**:\n{r['output']}" for r in worker_results)
    final_prompt = (f"原始任务：{user_input}\n\n"
                    f"各成员的工作成果：\n{all_results}\n\n"
                    f"请汇总所有成员的成果，形成最终完整交付。")
    result = await run_single(task_id, manager, final_prompt, event_queue, user_id)
    return result


async def run_swarm(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
    max_swarm_iterations: int = 5,
) -> str:
    """群体自组织模式：共享上下文，Agent 自选子任务"""
    await _emit_event(None, task_id, "swarm_start",
                      {"agents": [a.name for a in agents], "max_iterations": max_swarm_iterations},
                      event_queue=event_queue)

    shared_context = [f"## 任务\n{user_input}\n"]
    swarm_outputs = []

    for iteration in range(max_swarm_iterations):
        await _emit_event(None, task_id, "swarm_iteration",
                          {"iteration": iteration + 1, "total": max_swarm_iterations},
                          event_queue=event_queue)

        new_context = []
        for agent in agents:
            ctx = "\n\n".join(shared_context + swarm_outputs)
            prompt = (f"{ctx}\n\n"
                      f"你正在参与一项群体协作任务。请阅读以上所有上下文后：\n"
                      f"1. 选择一个尚未被解决的子问题\n"
                      f"2. 给出你的解决方案\n"
                      f"如果任务已完成，回复 DONE。")
            out = await run_single(task_id, agent, prompt, event_queue, user_id)
            new_context.append(f"**[{agent.name}]** (第 {iteration + 1} 轮):\n{out}")
            swarm_outputs.append(f"**[{agent.name}]** (第 {iteration + 1} 轮):\n{out}")

        shared_context = new_context

    return "\n\n---\n\n".join(swarm_outputs)


async def run_custom(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    pipeline_steps: list[str],
    event_queue: asyncio.Queue,
    user_id: int,
) -> str:
    """自定义流水线模式"""
    agent_map = {a.name: a for a in agents}
    agent_map.update({str(a.id): a for a in agents})

    context = user_input
    results = []

    for i, step in enumerate(pipeline_steps):
        # 格式: "agent_name_or_id:prompt_suffix" 或 "agent_name_or_id"
        parts = step.split(":", 1)
        agent_key = parts[0].strip()
        suffix = parts[1].strip() if len(parts) > 1 else ""

        agent = agent_map.get(agent_key)
        if not agent:
            await _emit_event(None, task_id, "custom_error",
                              {"step": i + 1, "error": f"Agent '{agent_key}' 不存在"},
                              event_queue=event_queue)
            continue

        await _emit_event(None, task_id, "custom_step",
                          {"step": i + 1, "agent": agent.name},
                          event_queue=event_queue)

        prompt = f"{context}\n\n{suffix}".strip()
        out = await run_single(task_id, agent, prompt, event_queue, user_id)
        context = out
        results.append(out)

    return "\n\n---\n\n".join(results)


# ============================================================
# 编排入口
# ============================================================

MODE_RUNNERS = {
    "single": run_single,
    "sequential": run_sequential,
    "parallel": run_parallel,
    "debate": run_debate,
    "vote": run_vote,
    "hierarchical": run_hierarchical,
    "swarm": run_swarm,
    "custom": run_custom,
}


async def execute_task(
    task_id: str,
    event_queue: asyncio.Queue,
    user_id: int,
    agent_ids: list[int] | None = None,
    pipeline_steps: list[str] | None = None,
) -> str:
    """执行任务的入口函数（从 API 层调用）"""
    get_pause_event(task_id)  # 初始化暂停事件

    async with create_session() as session:
        task = await session.get(TaskModel, task_id)
        if not task:
            await _emit_event(session, task_id, "task_error",
                              {"error": "任务不存在"}, event_queue=event_queue)
            return ""

        mode = task.mode or "single"

        # 获取 Agent 列表
        if agent_ids:
            agents = []
            for aid in agent_ids:
                a = await session.get(AgentModel, aid)
                if a:
                    agents.append(a)
        else:
            # 取该用户的所有 Agent
            from sqlalchemy import select
            stmt = select(AgentModel).where(AgentModel.user_id == user_id).limit(5)
            result = await session.execute(stmt)
            agents = list(result.scalars().all())

        if not agents:
            await _emit_event(session, task_id, "task_error",
                              {"error": "没有可用的 Agent，请先创建 Agent"},
                              event_queue=event_queue)
            return ""

        # 更新状态为 running
        task.status = "running"
        task.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
        task.assigned_agent = ", ".join(a.name for a in agents)
        await session.commit()

        await _emit_event(session, task_id, "task_start",
                          {"mode": mode, "agents": [a.name for a in agents],
                           "input": (task.description or "")[:200]},
                          event_queue=event_queue)

        try:
            runner = MODE_RUNNERS[mode]
            extra_kw = {}
            if mode == "custom":
                extra_kw["pipeline_steps"] = pipeline_steps or []
            if mode == "debate":
                extra_kw["rounds"] = 2

            result = await runner(
                task_id=task_id,
                agents=agents,
                user_input=task.description or "",
                event_queue=event_queue,
                user_id=user_id,
                **extra_kw,
            )

            task.result = result
            task.status = "completed"
            task.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await session.commit()

            await _emit_event(session, task_id, "task_completed",
                              {"result_length": len(result)},
                              event_queue=event_queue)

            # 清理暂停事件
            _active_tasks.pop(task_id, None)
            return result

        except Exception as e:
            logger.exception(f"任务执行失败: {task_id}")
            task.status = "failed"
            task.error = str(e)
            task.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await session.commit()

            await _emit_event(session, task_id, "task_failed",
                              {"error": str(e)},
                              event_queue=event_queue)

            _active_tasks.pop(task_id, None)
            raise


def pause_task(task_id: str) -> bool:
    """暂停任务"""
    if task_id in _active_tasks:
        _active_tasks[task_id].clear()
        return True
    return False


def resume_task(task_id: str) -> bool:
    """恢复任务"""
    if task_id in _active_tasks:
        _active_tasks[task_id].set()
        return True
    return False
