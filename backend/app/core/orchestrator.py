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
from pathlib import Path

from ..database import create_session
from ..models.agent import Agent as AgentModel
from ..models.task import Task as TaskModel, TaskEvent as TaskEventModel
from .llm import llm_manager
from .memory import memory_manager
from .rag import rag_service
from ..config import settings

logger = logging.getLogger("ai_hubs.orchestrator")

# 运行中的任务（内存跟踪，支持暂停/恢复）
_active_tasks: dict[str, asyncio.Event] = {}  # task_id -> pause_event

# 任务产出文件扩展名（会展示给用户下载）
_OUTPUT_EXTENSIONS = {
    ".pptx", ".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".gif",
    ".svg", ".html", ".csv", ".json", ".txt", ".md", ".py", ".js", ".zip",
}

# 扫描前快照（用于检测新增文件）
_pre_scan_snapshots: dict[int, set] = {}  # user_id -> 执行前文件集合


def get_pause_event(task_id: str) -> asyncio.Event:
    """获取任务的暂停事件（不存在则创建）"""
    if task_id not in _active_tasks:
        _active_tasks[task_id] = asyncio.Event()
        _active_tasks[task_id].set()  # 初始不暂停
    return _active_tasks[task_id]


async def _snapshot_workspace(user_id: int) -> set:
    """获取用户工作区当前所有文件路径的快照"""
    from .sandbox import list_files as sandbox_list
    result = sandbox_list(".", user_id)
    paths = set()
    if result.get("ok"):
        for entry in result.get("entries", []):
            if entry.get("type") == "file":
                paths.add(entry.get("path", ""))
    return paths


async def _collect_output_files(user_id: int) -> list[dict]:
    """任务执行后的产出文件列表（新增 + 已知类型文件）"""
    from .sandbox import list_files as sandbox_list

    result = sandbox_list(".", user_id)
    if not result.get("ok"):
        return []

    prev = _pre_scan_snapshots.pop(user_id, set())
    current = set()
    outputs = []

    for entry in result.get("entries", []):
        if entry.get("type") != "file":
            continue
        path = entry.get("path", "")
        name = entry.get("name", "")
        size = entry.get("size", 0)
        current.add(path)

        ext = Path(name).suffix.lower() if name else ""
        is_new = path not in prev
        is_artifact = ext in _OUTPUT_EXTENSIONS

        if is_new or is_artifact:
            outputs.append({
                "path": path,
                "name": name,
                "size": size,
                "is_new": is_new,
                "ext": ext,
            })

    return outputs


async def _emit_event(session, task_id: str, event: str, data: dict = None, *, event_queue: asyncio.Queue = None):
    """记录事件到 DB 并推送到 SSE 队列

    session 为 None 时（例如在 run_single 内部），自动开一个独立会话写入，
    避免上层未传递 session 导致 'NoneType' object has no attribute 'add'。
    """
    tz = timezone.utc
    evt = TaskEventModel(
        task_id=task_id,
        event=event,
        data=data or {},
    )
    # 手动设时间避免 sqlite 默认值问题
    evt.created_at = datetime.now(tz).replace(tzinfo=None)

    if session is not None:
        session.add(evt)
        await session.commit()
    else:
        async with create_session() as s:
            s.add(evt)
            await s.commit()

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
    enable_tools: bool = True,
    session: "AsyncSession | None" = None,
) -> str:
    """单 Agent 模式（含记忆上下文 + RAG 注入 + 工具调用 + 记忆提交）。

    enable_tools=True 时 Agent 可通过 Function Calling 执行代码、
    读写文件，从而生成 PPT/文档等实际产出。
    """
    pause_evt = get_pause_event(task_id)
    await pause_evt.wait()

    # ── 构建记忆上下文（长期摘要 + 近期窗口 + 相关性检索）──
    mem_agent_key = "__global__" if agent.config_mode == "global" else agent.name
    memory_ctx = await memory_manager.build_context(
        user_id, mem_agent_key, query=user_input, memory_strength=agent.memory_strength
    )
    # ── RAG 检索（Agent 开启 enable_rag 时）──
    rag_ctx = ""
    if agent.enable_rag:
        rag_ctx = await rag_service.build_context(user_id, user_input, category=agent.category)

    system_parts = []
    if agent.system_prompt:
        system_parts.append(agent.system_prompt)
    for m in memory_ctx:
        if m.get("role") == "system":
            system_parts.append(m["content"])
    if rag_ctx:
        system_parts.append(rag_ctx)
    system_content = "\n\n".join(system_parts) or "你是一个 AI 助手。"

    messages = [{"role": "system", "content": system_content}]
    for m in memory_ctx:
        if m.get("role") != "system":
            messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": user_input})

    await _emit_event(None, task_id, "agent_start",
                      {"agent": agent.name, "provider": agent.provider, "model": agent.model,
                       "memory_entries": len(memory_ctx), "rag": bool(rag_ctx),
                       "tools_enabled": enable_tools},
                      event_queue=event_queue)

    try:
        if enable_tools:
            result = await _run_with_tools(
                task_id, agent, messages, user_id, pause_evt, event_queue, session=session
            )
        else:
            result = await _run_text_only(
                task_id, agent, messages, pause_evt, event_queue
            )

        await _emit_event(None, task_id, "agent_done",
                          {"agent": agent.name, "length": len(result)},
                          event_queue=event_queue)

        # ── 提交本轮记忆 ──
        try:
            await memory_manager.add_turn(
                user_id, mem_agent_key,
                [
                    {"role": "user", "content": user_input},
                    {"role": "assistant", "content": result},
                ],
                message=f"task {task_id[:8]}",
            )
        except Exception as me:
            logger.warning(f"记忆提交失败（不影响主流程）: {me}")

        return result
    except Exception as e:
        await _emit_event(None, task_id, "agent_error",
                          {"agent": agent.name, "error": str(e)},
                          event_queue=event_queue)
        raise


async def _run_text_only(
    task_id: str,
    agent: AgentModel,
    messages: list[dict],
    pause_evt: asyncio.Event,
    event_queue: asyncio.Queue,
) -> str:
    """纯文本模式（无工具调用）"""
    full = []
    async for chunk in llm_manager.stream_chat(messages, model=agent.model):
        await pause_evt.wait()
        full.append(chunk)
    return "".join(full)


async def _run_with_tools(
    task_id: str,
    agent: AgentModel,
    messages: list[dict],
    user_id: int,
    pause_evt: asyncio.Event,
    event_queue: asyncio.Queue,
    session: "AsyncSession | None" = None,
) -> str:
    """工具调用模式：LLM 可调用 run_code / write_file 等工具完成实际工作"""
    from functools import partial
    from .tools import TOOL_DEFINITIONS, execute_tool

    text_parts: list[str] = []

    async for evt in llm_manager.stream_with_tools(
        messages=messages,
        tools=TOOL_DEFINITIONS,
        tool_executor=partial(execute_tool, session=session),
        user_id=user_id,
        model=agent.model,
        max_tool_rounds=10,
    ):
        await pause_evt.wait()

        if evt["type"] == "delta":
            text_parts.append(evt["content"])

        elif evt["type"] == "tool_start":
            await _emit_event(None, task_id, "tool_start",
                              {"agent": agent.name, "tool": evt["name"],
                               "summary": evt.get("summary", ""), "args": evt.get("args", {})},
                              event_queue=event_queue)

        elif evt["type"] == "tool_result":
            # 工具结果可能很长，摘要截断
            result_preview = (evt.get("result") or "")[:500]
            await _emit_event(None, task_id, "tool_result",
                              {"agent": agent.name, "tool": evt["name"],
                               "result_preview": result_preview},
                              event_queue=event_queue)

        elif evt["type"] == "done":
            break

    return "".join(text_parts)


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

async def _select_agent_direct(
    user_input: str,
    agents: list[AgentModel],
) -> AgentModel | None:
    """直接指派：根据 Agent 的标签/名称/描述与任务内容的重合度打分，取最高分者"""
    if not agents:
        return None
    if len(agents) == 1:
        return agents[0]

    text = (user_input or "").lower()
    best: AgentModel | None = None
    best_score = -1.0
    for a in agents:
        score = 0.0
        # 名称/描述命中
        hay = f"{a.name} {a.description or ''}".lower()
        for token in text.split():
            if len(token) >= 2 and token in hay:
                score += 1.0
        # 标签命中
        for tag in (a.tags or []):
            if tag and tag.lower() in text:
                score += 2.0
        # 分类命中
        if a.category and a.category.lower() != "general" and a.category.lower() in text:
            score += 1.5
        # 轻微偏好记忆强度高的 Agent
        score += (a.memory_strength or 0) * 0.02
        if score > best_score:
            best_score, best = score, a
    # 没有任何命中时，回退到第一个（保证始终有指派）
    return best or agents[0]


async def _select_agent_by_ai(
    user_input: str,
    agents: list[AgentModel],
    event_queue: asyncio.Queue,
) -> AgentModel | None:
    """AI 分析：让 LLM 阅读任务内容与各 Agent 画像，返回最合适 Agent 的编号（更精细）"""
    if not agents:
        return None
    if len(agents) == 1:
        return agents[0]

    catalog = "\n".join(
        f"{i}. [ID={a.id}] 名称：{a.name} | 描述：{a.description or '无'} "
        f"| 标签：{', '.join(a.tags or []) or '无'} | 分类：{a.category}"
        for i, a in enumerate(agents)
    )
    prompt = (
        "你是一个任务分派调度器。下面是一批可用的 AI Agent 及其专长画像：\n\n"
        f"{catalog}\n\n"
        f"待处理任务内容：\n{user_input}\n\n"
        "请综合分析任务的领域、复杂度与所需能力，从上面列表中选择最合适执行该任务的 Agent。\n"
        "只回复一个数字编号（即列表最前面的序号），不要输出任何解释或额外字符。"
    )
    try:
        resp = await llm_manager.chat(
            [{"role": "system", "content": "你是严谨的任务分派器，只输出 Agent 编号。"},
             {"role": "user", "content": prompt}],
            model=agents[0].model,
        )
        # 解析编号
        digits = "".join(ch for ch in resp if ch.isdigit())
        idx = int(digits) if digits else 0
        if 0 <= idx < len(agents):
            return agents[idx]
    except Exception as e:
        logger.warning(f"AI 指派失败，回退到直接匹配: {e}")
    # 失败时回退
    return await _select_agent_direct(user_input, agents)


async def run_auto(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
    assignment: str = "direct",   # direct | ai
) -> str:
    """自动工作流：根据任务内容自动指派 Agent 执行

    - direct：基于标签/关键词/分类直接匹配最合适的 Agent
    - ai：先由 AI 分析任务与 Agent 画像，再做精细指派
    """
    if not agents:
        raise RuntimeError("没有可用的 Agent，无法自动指派")

    await _emit_event(None, task_id, "auto_assign_start",
                      {"assignment": assignment, "candidates": [a.name for a in agents]},
                      event_queue=event_queue)

    if assignment == "ai":
        chosen = await _select_agent_by_ai(user_input, agents, event_queue)
        strategy = "ai 分析指派"
    else:
        chosen = await _select_agent_direct(user_input, agents)
        strategy = "直接匹配指派"

    if chosen is None:
        chosen = agents[0]

    await _emit_event(None, task_id, "auto_assigned",
                      {"agent": chosen.name, "strategy": strategy},
                      event_queue=event_queue)

    # 复用单 Agent 执行流程
    return await run_single(
        task_id=task_id,
        agent=chosen,
        user_input=user_input,
        event_queue=event_queue,
        user_id=user_id,
    )


MODE_RUNNERS = {
    "single": run_single,
    "sequential": run_sequential,
    "parallel": run_parallel,
    "debate": run_debate,
    "vote": run_vote,
    "hierarchical": run_hierarchical,
    "swarm": run_swarm,
    "custom": run_custom,
    "auto": run_auto,
}


async def execute_task(
    task_id: str,
    event_queue: asyncio.Queue,
    user_id: int,
    agent_ids: list[int] | None = None,
    pipeline_steps: list[str] | None = None,
    assignment: str = "direct",   # direct | ai （仅 auto 模式使用）
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

        # ── 执行前快照（用于检测新增文件）──
        try:
            _pre_scan_snapshots[user_id] = await _snapshot_workspace(user_id)
        except Exception:
            pass

        try:
            runner = MODE_RUNNERS[mode]
            extra_kw = {}
            if mode == "custom":
                extra_kw["pipeline_steps"] = pipeline_steps or []
            if mode == "debate":
                extra_kw["rounds"] = 2
            if mode == "auto":
                extra_kw["assignment"] = assignment

            if mode == "single":
                # run_single 仅接受单个 agent，而非 agents 列表
                result = await run_single(
                    task_id=task_id,
                    agent=agents[0],
                    user_input=task.description or "",
                    event_queue=event_queue,
                    user_id=user_id,
                    session=session,
                )
            else:
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

            # ── 扫描工作区产出文件 ──
            output_files = await _collect_output_files(user_id)
            if output_files:
                meta = dict(task.metadata_ or {})
                meta["output_files"] = output_files
                task.metadata_ = meta

            await session.commit()

            await _emit_event(session, task_id, "task_completed",
                              {"result_length": len(result),
                               "output_files": output_files},
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
