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
from .tools import TOOL_SYSTEM_PROMPT, should_enable_code_tools
from .blackboard import get_blackboard, drop_blackboard
from .guardrails import guard_output
from . import scorer as _scorer
from . import contracts as _contracts
from .collab import run_peer_review, run_round_table
from .workflow_runner import run_workflow_graph
from . import metrics_collector as _metrics
from ..config import settings

# 并行模式最大并发 Agent 数（避免一次性拉起过多 Agent 同时打 LLM 导致限流/超时）
MAX_PARALLEL_AGENTS = 5

# 任务级 token 用量回调钩子：execute_task 注册，run_single 内部按 task_id 取用（避免逐层透传参数）
_TASK_USAGE_HOOKS: dict[str, Callable[[int, int], None]] = {}

logger = logging.getLogger("ai_hubs.orchestrator")


import re as _re

def _clean_result(text: str) -> str:
    """清理 LLM 输出中残留的 XML/DSML 工具调用标签。"""
    # 移除 <| |DSML| |...> 或 < | | DSML | | ... > 形式的标签
    text = _re.sub(r'<\s*\|\s*\|\s*\w[\w\s]*\|[^>]*>', '', text)
    text = _re.sub(r'</\s*\|\s*\|\s*\w[\w\s]*\|[^>]*>', '', text)
    # 移除 <tool_calls>...</tool_calls> 整块（含内容）
    text = _re.sub(r'<tool_calls>.*?</tool_calls>', '', text, flags=_re.DOTALL)
    text = _re.sub(r'<invoke\b[^>]*>.*?</invoke>', '', text, flags=_re.DOTALL)
    return text.strip()

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
    """任务执行后的产出文件列表（仅新增文件）。
    如果没有预先做快照（user_id 不在 _pre_scan_snapshots 中），
    说明本次执行不涉及文件操作，直接返回空列表，避免误报。
    """
    from .sandbox import list_files as sandbox_list

    # 没有预先快照 → 本次不应该有产出文件
    if user_id not in _pre_scan_snapshots:
        return []

    result = sandbox_list(".", user_id)
    if not result.get("ok"):
        return []

    prev = _pre_scan_snapshots.pop(user_id, set())
    outputs = []

    for entry in result.get("entries", []):
        if entry.get("type") != "file":
            continue
        path = entry.get("path", "")
        name = entry.get("name", "")
        size = entry.get("size", 0)

        ext = Path(name).suffix.lower() if name else ""
        is_new = path not in prev

        if is_new:
            outputs.append({
                "path": path,
                "name": name,
                "size": size,
                "is_new": is_new,
                "ext": ext,
            })

    return outputs


# ── SSE 事件广播注册表（修复「任务卡死在开始阶段」议题）──
# 历史实现里 stream_events 与 execute 各自创建独立的 asyncio.Queue，两者从未
# 连通，导致 SSE 永远收不到实时事件、前端只在「开始」后卡死。此处用全局注册表
# 把每个 task 的 SSE 订阅队列登记起来，_emit_event 在写入 DB 的同时向所有订阅者广播。
_task_sse_queues: dict[str, list[asyncio.Queue]] = {}


def register_sse_queue(task_id: str, queue: asyncio.Queue) -> None:
    """SSE 连接建立时登记自己的队列，开始接收该任务的实时事件。"""
    _task_sse_queues.setdefault(task_id, []).append(queue)


def unregister_sse_queue(task_id: str, queue: asyncio.Queue) -> None:
    """SSE 连接断开时注销，避免泄漏。"""
    qs = _task_sse_queues.get(task_id)
    if qs and queue in qs:
        qs.remove(queue)
        if not qs:
            _task_sse_queues.pop(task_id, None)


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

    payload = {
        "time": evt.created_at.isoformat(timespec="seconds"),
        "event": event,
        "data": data or {},
    }
    if event_queue is not None:
        await event_queue.put(payload)
    # 广播给所有 SSE 订阅者（任务卡死修复）
    for q in list(_task_sse_queues.get(task_id, [])):
        try:
            await q.put(payload)
        except Exception:
            pass


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
    on_usage: Optional[Callable[[int, int], None]] = None,
) -> str:
    """单 Agent 模式（含记忆上下文 + RAG 注入 + 工具调用 + 记忆提交）。

    enable_tools=True 时 Agent 可通过 Function Calling 执行代码、
    读写文件，从而生成 PPT/文档等实际产出。
    """
    pause_evt = get_pause_event(task_id)
    await pause_evt.wait()

    # ── 构建记忆上下文（长期摘要 + 近期窗口 + 相关性检索）──
    # global 模式记忆键为 "__global__"；memory_manager 以 (user_id, key) 隔离，
    # 不同用户天然分区、不会跨用户混写；多个 global Agent 共享同一 user 的 global 键（设计意图）。
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
    # 注入工具使用指引（含 create_task 主动调用提示）；无代码权限时不授予代码能力说明
    if should_enable_code_tools(agent.skills):
        system_parts.append(TOOL_SYSTEM_PROMPT)
    else:
        system_parts.append(
            "你可以使用对话类工具与内部 API，但当前未被授予代码执行/文件读写权限，"
            "请勿尝试运行代码或读写文件。"
        )
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
            # 任务级用量钩子：优先用显式 on_usage，否则取 execute_task 注册的 task_id 钩子
            usage_hook = on_usage or _TASK_USAGE_HOOKS.get(task_id)
            result = await _run_with_tools(
                task_id, agent, messages, user_id, pause_evt, event_queue,
                session=session, on_usage=usage_hook,
            )
        else:
            result = await _run_text_only(
                task_id, agent, messages, pause_evt, event_queue
            )

        # ── 内容护栏（议题 #9③）：L3 注入清洗 + L2 内容标记 ──
        # 在把产出交给下游 Agent / 写入记忆前清洗，防止注入污染与敏感内容沉淀
        guarded, verdict = guard_output(result)
        if verdict.status != "info":
            await _emit_event(None, task_id, "guardrail",
                              {"agent": agent.name, "status": verdict.status,
                               "reasons": verdict.reasons},
                              event_queue=event_queue)
        result = guarded

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
    on_usage: Optional[Callable[[int, int], None]] = None,
) -> str:
    """工具调用模式：LLM 可调用 run_code / write_file 等工具完成实际工作"""
    from functools import partial
    from .tools import TOOL_DEFINITIONS, execute_tool

    text_parts: list[str] = []

    async for evt in llm_manager.stream_with_tools(
        messages=messages,
        tools=get_enabled_tools(agent.skills),
        on_usage=on_usage,
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

    # 并发限流：限制同时打 LLM 的 Agent 数，避免限流/超时雪崩
    sem = asyncio.Semaphore(min(len(agents), MAX_PARALLEL_AGENTS))

    async def _run_one(agent: AgentModel) -> dict:
        try:
            async with sem:
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

    # 工作者并行执行各自的子任务（受并发限流约束）
    sem = asyncio.Semaphore(min(len(workers), MAX_PARALLEL_AGENTS))

    async def _worker(w: AgentModel, idx: int):
        sub_prompt = f"主管分解的子任务（第 {idx + 1} 项）：\n{plan}\n\n请完成分配给你的部分。"
        try:
            async with sem:
                out = await run_single(task_id, w, sub_prompt, event_queue, user_id)
            return {"agent": w.name, "output": out}
        except Exception as e:
            return {"agent": w.name, "error": str(e)}

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
    strict: bool = False,
) -> str:
    """自定义流水线模式（议题 #6 结构化契约 + #7 阶段间质量门控 + #1 Blackboard）"""
    agent_map = {a.name: a for a in agents}
    agent_map.update({str(a.id): a for a in agents})

    board = get_blackboard(task_id, "custom")
    for a in agents:
        board.join_participant(a.name)

    context = user_input
    results = []

    for i, step in enumerate(pipeline_steps):
        # 格式: "agent_name_or_id:prompt_suffix [@schema=SchemaName]"
        # 末尾可附 @schema=Name 声明该阶段产出需满足的结构化契约
        schema_name = None
        m_schema = _re.search(r"@schema=([A-Za-z_]+)\s*$", step)
        if m_schema:
            schema_name = m_schema.group(1)
            step = step[:m_schema.start()].strip()

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
                          {"step": i + 1, "agent": agent.name, "schema": schema_name},
                          event_queue=event_queue)

        prompt = f"{context}\n\n{suffix}".strip()
        out = await run_single(task_id, agent, prompt, event_queue, user_id)

        # ── 阶段间质量门控（议题 #7）：Gate-1 结构化校验 / Gate-2 质量评分 ──
        validated_obj = None
        if schema_name:
            obj, err = _contracts.extract_structured(out)
            if obj is not None:
                ok, cerr = _contracts.validate_contract(obj, schema_name, None)
                if ok:
                    validated_obj = obj
                else:
                    # 重试一次（把校验错误回灌给 Agent）
                    await _emit_event(None, task_id, "custom_gate_retry",
                                      {"step": i + 1, "reason": f"结构不符: {cerr}"},
                                      event_queue=event_queue)
                    retry = await run_single(
                        task_id, agent,
                        f"{prompt}\n\n上一次产出不符合结构要求（{cerr}），"
                        f"请严格输出满足 schema={schema_name} 的 JSON。",
                        event_queue, user_id,
                    )
                    obj2, err2 = _contracts.extract_structured(retry)
                    if obj2 is not None and _contracts.validate_contract(obj2, schema_name, None)[0]:
                        validated_obj = obj2
                        out = retry
                    else:
                        await _emit_event(None, task_id, "custom_gate_warn",
                                          {"step": i + 1, "reason": "结构化校验失败，降级为文本接力"},
                                          event_queue=event_queue)
            else:
                await _emit_event(None, task_id, "custom_gate_warn",
                                  {"step": i + 1, "reason": f"未解析到结构化产出: {err}"},
                                  event_queue=event_queue)

        # Gate-2：严格模式下对产出做质量评分（低于阈值重试一次）
        if strict and not schema_name:
            sc = await _scorer.score(out, task_id and f"{user_input}", strict=True)
            if not sc.passed:
                await _emit_event(None, task_id, "custom_gate_retry",
                                  {"step": i + 1, "score": sc.total, "notes": sc.notes},
                                  event_queue=event_queue)
                retry = await run_single(
                    task_id, agent,
                    f"{prompt}\n\n你的上一版产出质量不足（{sc.notes}），请改进后重新输出。",
                    event_queue, user_id,
                )
                sc2 = await _scorer.score(retry, user_input, strict=True)
                if sc2.passed:
                    out = retry

        # 写入 Blackboard（结构化优先，便于下游程序消费）
        if validated_obj is not None:
            board.write_public(agent.name, f"stage_{i}", validated_obj)
            context = _contracts.format_for_next(validated_obj, f"阶段{i+1}产出")
        else:
            board.write_public(agent.name, f"stage_{i}", out)
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


async def _analyze_task_by_ai(
    title: str,
    description: str,
    event_queue: asyncio.Queue,
) -> dict | None:
    """AI 分析任务：提取关键词、拓展描述、分类任务

    当任务描述较短或较模糊时，AI 会自动拓展任务描述，
    使其更清晰、更具体，便于后续 Agent 执行。
    """
    full_text = f"标题：{title}\n描述：{description}"
    text_len = len((title or "") + (description or ""))

    # 描述较长时跳过拓展，只做关键词提取
    need_expand = text_len < 200

    prompt = (
        "你是一个专业的任务分析专家。请分析以下任务，输出 JSON 格式的分析结果。\n\n"
        f"任务标题：{title or '未命名'}\n"
        f"任务描述：{description or '（无）'}\n\n"
        "请输出严格的 JSON 格式，包含以下字段：\n"
        "1. keywords: 字符串数组，3-8个关键词，概括任务的核心主题和技术栈\n"
        "2. category: 字符串，任务分类（如：代码开发、文档写作、数据分析、PPT制作、创意设计、研究分析、通用任务等）\n"
        "3. difficulty: 字符串，难度评估（简单/中等/复杂）\n"
        "4. expanded_description: 字符串，" + ("拓展后的详细任务描述，补充任务目标、输出要求、注意事项等，使任务更清晰具体（200-500字）" if need_expand else "与原描述一致即可") + "\n"
        "5. estimated_duration: 字符串，预估耗时\n"
        "6. key_points: 字符串数组，任务的核心要点和注意事项（3-5条）\n\n"
        "只输出 JSON，不要输出任何解释或额外文字。"
    )
    try:
        resp = await llm_manager.chat(
            [{"role": "system", "content": "你是严谨的任务分析专家，只输出 JSON 格式。"},
             {"role": "user", "content": prompt}],
            temperature=0.3,
        )
        # 解析 JSON
        import json as _json
        # 尝试从响应中提取 JSON（可能被代码块包裹）
        resp_clean = resp.strip()
        if resp_clean.startswith("```"):
            resp_clean = resp_clean.strip("`")
            if resp_clean.lower().startswith("json"):
                resp_clean = resp_clean[4:].strip()
        result = _json.loads(resp_clean)
        # 确保字段存在
        if not isinstance(result.get("keywords"), list):
            result["keywords"] = []
        if not result.get("category"):
            result["category"] = "通用任务"
        if not result.get("expanded_description"):
            result["expanded_description"] = description or title
        return result
    except Exception as e:
        logger.warning(f"AI 任务分析失败: {e}")
        return None


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


# 自动分配器可选择的全部模式（单 Agent 场景会回退 single）
_ALLOC_MODES = ["single", "sequential", "parallel", "debate", "vote",
                "hierarchical", "swarm", "peer_review", "round_table"]
# 需要 >=2 个 Agent 的协作模式
_MULTIAGENT_MODES = {"debate", "vote", "hierarchical", "swarm", "peer_review", "round_table"}


def _heuristic_mode(user_input: str, difficulty: str, category: str, n_agents: int) -> tuple[str, str]:
    """无 LLM 的关键词启发式模式分配（覆盖全部模式）。"""
    text = (user_input or "").lower()
    if n_agents < 2:
        return "single", "仅一个可用 Agent，单 Agent 执行"
    # 关键词 → 模式
    if any(k in text for k in ("辩论", "对立", "双方", "正方", "反方", "debate")):
        return "debate", "检测到辩论/对立诉求，启用辩论模式"
    if any(k in text for k in ("投票", "表决", "少数服从多数", "vote", "选一个")):
        return "vote", "检测到需要表决，启用投票模式"
    if any(k in text for k in ("评审", "审查", "互审", "peer", "review")):
        return "peer_review", "检测到同行评审诉求，启用 peer_review 模式"
    if any(k in text for k in ("圆桌", "讨论", "集思", "round", "brainstorm")):
        return "round_table", "检测到圆桌讨论诉求，启用 round_table 模式"
    if any(k in text for k in ("分解", "主管", "分层", "层级", "hierarch")):
        return "hierarchical", "检测到层级分解诉求，启用 hierarchical 模式"
    if any(k in text for k in ("自组织", " swarm", "群策", "多角色自由")):
        return "swarm", "检测到自组织协作诉求，启用 swarm 模式"
    # 难度/分类兜底
    if difficulty == "复杂" and n_agents >= 3:
        return "sequential", "复杂任务，多 Agent 串行协作"
    if category in ("创意设计", "研究分析", "方案对比") and n_agents >= 3:
        return "parallel", "创意/分析类任务，多 Agent 并行产出"
    if n_agents >= 2:
        return "parallel", "多 Agent 可用，并行产出多视角结果"
    return "single", "标准任务，单 Agent 执行"


async def _allocate_mode_by_ai(
    user_input: str, analysis: dict | None, agents: list[AgentModel],
    available_workflows: list | None = None,
) -> tuple[str, str]:
    """LLM 分配器：从全部模式中选择最合适者（议题 #4），可返回 workflow:<id>。"""
    n = len(agents)
    if n < 2:
        return "single", "仅一个可用 Agent，单 Agent 执行"
    try:
        mode_desc = (
            "single(单Agent) | sequential(串行协作) | parallel(并行多视角) | "
            "debate(辩论交锋) | vote(投票决议) | hierarchical(主管分解委派) | "
            "swarm(群体自组织) | peer_review(同行互审) | round_table(圆桌讨论)"
        )
        wf_desc = ""
        if available_workflows:
            wf_items = "; ".join(
                f"{w.get('id')}:{w.get('name', '')}" for w in available_workflows
            )
            wf_desc = (
                f"\n\n用户已创建的可复用工作流（若任务高度契合可直接选用，"
                f"此时 mode 输出 workflow:<id>）：\n{wf_items}"
            )
        prompt = (
            "你是任务编排调度器。根据任务内容，从以下执行模式中选择最合适的一个：\n"
            f"{mode_desc}{wf_desc}\n\n"
            f"任务：\n{user_input[:800]}\n\n"
            "只输出 JSON：{\"mode\": \"<模式名或 workflow:<id>>\", "
            "\"reason\": \"<一句话理由>\"，\"不要输出其他文字。"
        )
        resp = await llm_manager.chat(
            [{"role": "system", "content": "你是严谨的编排调度器，只输出 JSON。"},
             {"role": "user", "content": prompt}],
            temperature=0.2,
        )
        import json as _json
        m = _re.search(r"\{.*\}", resp, _re.DOTALL)
        if m:
            data = _json.loads(m.group(0))
            mode = data.get("mode", "").strip().lower()
            if mode.startswith("workflow:"):
                wf_id = mode.split(":", 1)[1]
                if any(w.get("id") == wf_id for w in (available_workflows or [])):
                    return mode, data.get("reason", "AI 选用工作流")
                return "single", "所选工作流不存在，回退单 Agent"
            if mode in _ALLOC_MODES:
                if mode in _MULTIAGENT_MODES and n < 2:
                    return "single", "所选模式需多 Agent，回退单 Agent"
                return mode, data.get("reason", "AI 分配")
    except Exception as e:
        logger.warning(f"LLM 模式分配失败，回退启发式: {e}")
    return _heuristic_mode(user_input, (analysis or {}).get("difficulty", "简单"),
                           (analysis or {}).get("category", "通用"), n)


async def run_auto(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
    assignment: str = "direct",   # direct | ai
    task_title: str = "",
    available_workflows: list | None = None,   # auto 模式下 AI 可复用的具体工作流
) -> str:
    """自动工作流：AI 分析任务后自动选择工作流模式和 Agent

    工作流选择逻辑：
    - 简单任务 → single（单 Agent）
    - 需要多步骤协作 → sequential（串行）
    - 需要多角色并行产出 → parallel（并行）
    - 需要观点碰撞 → debate（辩论）
    """
    if not agents:
        raise RuntimeError("没有可用的 Agent，无法自动指派")

    await _emit_event(None, task_id, "auto_assign_start",
                      {"assignment": assignment, "candidates": [a.name for a in agents]},
                      event_queue=event_queue)

    final_input = user_input
    analysis = None

    if assignment == "ai":
        # ── AI 分析任务：关键词提取 + 描述拓展 + 任务分类 ──
        await _emit_event(None, task_id, "ai_analysis_start",
                          {"title": task_title, "input_length": len(user_input or "")},
                          event_queue=event_queue)

        analysis = await _analyze_task_by_ai(task_title, user_input, event_queue)
        if analysis:
            await _emit_event(None, task_id, "ai_analysis_done",
                              analysis,
                              event_queue=event_queue)
            # 用拓展后的描述作为最终输入
            if analysis.get("expanded_description"):
                final_input = (
                    f"## 任务标题\n{task_title or '未命名任务'}\n\n"
                    f"## 任务描述（AI 拓展）\n{analysis['expanded_description']}\n\n"
                    f"## 任务关键词\n{', '.join(analysis.get('keywords', []))}\n\n"
                    f"## 任务分类\n{analysis.get('category', '通用')}"
                )

        chosen = await _select_agent_by_ai(final_input, agents, event_queue)
        strategy = "ai 分析指派"
    else:
        chosen = await _select_agent_direct(user_input, agents)
        strategy = "直接匹配指派"

    if chosen is None:
        chosen = agents[0]

    # ── 自动选择工作流模式（议题 #4：覆盖全部 8+ 模式）──
    difficulty = (analysis or {}).get("difficulty", "简单")
    category = (analysis or {}).get("category", "通用")

    # 快路径：超短 / 简单问答 → 直接 single，零额外 LLM 调用
    if len(user_input or "") < 20:
        workflow_mode = "single"
        workflow_reason = "简短输入，单 Agent 直接处理"
    elif assignment == "ai":
        # LLM 分配器：返回全部模式中最合适的（含 debate/vote/hierarchical/swarm/peer_review/round_table/workflow:<id>）
        workflow_mode, workflow_reason = await _allocate_mode_by_ai(
            final_input, analysis, agents, available_workflows
        )
    else:
        # 关键词启发式（无 LLM）：覆盖更多模式
        workflow_mode, workflow_reason = _heuristic_mode(user_input, difficulty, category, len(agents))

    # 工作流模式：AI 选中了某个具体工作流 → 直接按该工作流拓扑执行
    if isinstance(workflow_mode, str) and workflow_mode.startswith("workflow:"):
        wf_id = workflow_mode.split(":", 1)[1]
        wf = next((w for w in (available_workflows or []) if w.get("id") == wf_id), None)
        if wf:
            await _emit_event(None, task_id, "auto_assigned",
                              {
                                  "agent": chosen.name,
                                  "strategy": strategy,
                                  "workflow_mode": "workflow",
                                  "workflow_id": wf_id,
                                  "workflow_name": wf.get("name", ""),
                                  "workflow_reason": workflow_reason,
                                  "difficulty": difficulty,
                                  "category": category,
                              },
                              event_queue=event_queue)
            return await run_workflow(
                task_id=task_id, agents=agents, user_input=final_input,
                event_queue=event_queue, user_id=user_id,
                nodes=wf.get("nodes"), edges=wf.get("edges"),
            )
        # 工作流不存在（已被删）→ 回退单 Agent
        workflow_mode = "single"
        workflow_reason = "所选工作流不可用，已回退单 Agent"

    await _emit_event(None, task_id, "auto_assigned",
                      {
                          "agent": chosen.name,
                          "strategy": strategy,
                          "workflow_mode": workflow_mode,
                          "workflow_reason": workflow_reason,
                          "difficulty": difficulty,
                          "category": category,
                      },
                      event_queue=event_queue)

    # 根据选择的工作流模式执行
    if workflow_mode == "sequential" and len(agents) >= 2:
        # 串行模式：选择 2-3 个相关 Agent
        selected_agents = [chosen]
        for a in agents:
            if a.id != chosen.id and len(selected_agents) < min(3, len(agents)):
                selected_agents.append(a)
        return await run_sequential(
            task_id=task_id,
            agents=selected_agents,
            user_input=final_input,
            event_queue=event_queue,
            user_id=user_id,
        )
    elif workflow_mode == "parallel" and len(agents) >= 3:
        # 并行模式：选择 3 个相关 Agent
        selected_agents = [chosen]
        for a in agents:
            if a.id != chosen.id and len(selected_agents) < min(3, len(agents)):
                selected_agents.append(a)
        return await run_parallel(
            task_id=task_id,
            agents=selected_agents,
            user_input=final_input,
            event_queue=event_queue,
            user_id=user_id,
        )
    else:
        # 默认单 Agent
        return await run_single(
            task_id=task_id,
            agent=chosen,
            user_input=final_input,
            event_queue=event_queue,
            user_id=user_id,
        )


async def run_workflow(
    task_id: str,
    agents: list[AgentModel],
    user_input: str,
    event_queue: asyncio.Queue,
    user_id: int,
    nodes: list[dict] | None = None,
    edges: list[dict] | None = None,
) -> str:
    """自定义工作流执行（议题 #11）：按 WorkflowNode[]/edges 拓扑遍历，复用 Graph Runner。"""
    if not nodes:
        return "工作流为空（无 nodes），无法执行。"
    return await run_workflow_graph(
        task_id=task_id,
        nodes=nodes,
        edges=edges or [],
        user_id=user_id,
        event_queue=event_queue,
        agents=agents,
        initial_input=user_input,
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
    "peer_review": run_peer_review,
    "round_table": run_round_table,
    "workflow": run_workflow,
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

        # ── 任务路径 token 配额护栏（与 chat 一致：仅平台免费额度限制）──
        from ...models.user import User
        user = await session.get(User, user_id)
        using_own_key = bool((user.llm_config or {}).get("api_key")) if user else False
        if user and not using_own_key and user.role != "admin":
            quota = user.get_token_quota()
            if quota is not None and user.get_token_used() >= quota:
                await _emit_event(session, task_id, "task_error",
                                  {"error": f"您的任务 token 配额已用尽（上限 {quota}），"
                                            f"可在「设置」中填写自己的 API Key 后无限制使用，或联系管理员重置。"},
                                  event_queue=event_queue)
                _TASK_USAGE_HOOKS.pop(task_id, None)
                return ""

        # 注册任务级真实 token 用量钩子（run_single 内部按 task_id 取用）
        _usage_acc = {"prompt": 0, "completion": 0}

        def _on_usage(p: int, c: int) -> None:
            _usage_acc["prompt"] += p
            _usage_acc["completion"] += c

        _TASK_USAGE_HOOKS[task_id] = _on_usage

        # ── 执行前快照（用于检测新增文件）──
        try:
            _pre_scan_snapshots[user_id] = await _snapshot_workspace(user_id)
        except Exception:
            pass

        try:
            runner = MODE_RUNNERS[mode]
            extra_kw = {}
            meta = task.metadata_ or {}
            if mode == "custom":
                extra_kw["pipeline_steps"] = pipeline_steps or []
                extra_kw["strict"] = bool(meta.get("strict_mode", False))
            if mode == "debate":
                extra_kw["rounds"] = 2
            if mode in ("peer_review", "round_table"):
                extra_kw["rounds"] = int(meta.get("rounds", 2) or 2)
            if mode == "workflow":
                extra_kw["nodes"] = meta.get("workflow_nodes") or meta.get("nodes")
                extra_kw["edges"] = meta.get("workflow_edges") or meta.get("edges") or []
            if mode == "auto":
                extra_kw["assignment"] = assignment
                extra_kw["task_title"] = task.title or ""
                # 取出用户已创建的工作流，供 AI 分配器按需复用（议题 #11 联动）
                try:
                    from ..api.v1.workflows import list_workflows as _list_wf
                    _all_wf = _list_wf()
                    _allowed = (task.metadata_ or {}).get("allowed_workflows")
                    extra_kw["available_workflows"] = (
                        [w for w in _all_wf if w.get("id") in _allowed]
                        if _allowed else _all_wf
                    )
                except Exception:
                    extra_kw["available_workflows"] = []

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

            task.result = _clean_result(result)
            # 真实 token 用量扣减（仅平台免费额度；与 chat 一致）
            if user and not using_own_key and user.role != "admin":
                user.add_token_usage(_usage_acc["prompt"] + _usage_acc["completion"])
            task.status = "completed"
            task.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

            # ── 记录效率指标（议题 #15）：延迟/消耗/成本/协调轮次 ──
            try:
                _latency = (task.finished_at - task.started_at).total_seconds() if task.started_at else 0.0
                _metrics.record_task(
                    task_id=task_id, user_id=user_id, mode=mode,
                    model=agents[0].model if agents else "default",
                    agents=len(agents), latency_s=_latency,
                    in_tokens=_usage_acc["prompt"], out_tokens=_usage_acc["completion"],
                    success=True,
                    rounds=extra_kw.get("rounds"),
                )
            except Exception as me:
                logger.warning(f"效率指标记录失败（不影响主流程）: {me}")

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

            # 清理暂停事件与用量钩子
            _active_tasks.pop(task_id, None)
            _TASK_USAGE_HOOKS.pop(task_id, None)
            drop_blackboard(task_id)
            return result

        except Exception as e:
            logger.exception(f"任务执行失败: {task_id}")
            task.status = "failed"
            task.error = str(e)
            task.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

            # ── 记录效率指标（议题 #15）：失败也记录，用于可靠性聚合 ──
            try:
                _latency = (task.finished_at - task.started_at).total_seconds() if task.started_at else 0.0
                _metrics.record_task(
                    task_id=task_id, user_id=user_id, mode=mode,
                    model=agents[0].model if agents else "default",
                    agents=len(agents), latency_s=_latency,
                    in_tokens=_usage_acc["prompt"], out_tokens=_usage_acc["completion"],
                    success=False,
                    rounds=extra_kw.get("rounds"),
                )
            except Exception as me:
                logger.warning(f"效率指标记录失败（不影响主流程）: {me}")

            await session.commit()

            await _emit_event(session, task_id, "task_failed",
                              {"error": str(e)},
                              event_queue=event_queue)

            _active_tasks.pop(task_id, None)
            _TASK_USAGE_HOOKS.pop(task_id, None)
            drop_blackboard(task_id)
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
