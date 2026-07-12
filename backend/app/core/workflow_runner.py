# -*- coding: utf-8 -*-
"""
工作流 Graph Runner（议题 #11）— 真正执行用户自定义工作流

把 WorkflowNode[] / edges 拓扑遍历执行为 execution plan：
- start：入口
- agent：调用指定 Agent 执行（复用 run_single）
- tool ：调用内部工具（call_internal_api / run_code 等）
- condition：依据当前上下文做分支（轻量 LLM 判定）
- parallel：并发执行子节点（asyncio.gather）
- sequential：线性执行子节点
- end：出口

节点间传值复用 Blackboard（§1）+ 结构化契约（§6）。
"""

from __future__ import annotations

import logging

from .blackboard import get_blackboard

logger = logging.getLogger("ai_hubs.workflow_runner")

# 节点类型
NODE_START = "start"
NODE_AGENT = "agent"
NODE_TOOL = "tool"
NODE_CONDITION = "condition"
NODE_PARALLEL = "parallel"
NODE_SEQUENTIAL = "sequential"
NODE_END = "end"


def _index_nodes(nodes: list[dict]) -> dict[str, dict]:
    return {n.get("id"): n for n in nodes}


def _outgoing(edges: list[dict], node_id: str) -> list[dict]:
    return [e for e in edges if e.get("source") == node_id]


async def _run_agent_node(node: dict, task_id: str, event_queue, user_id: int,
                          ctx_text: str, get_agent) -> str:
    from .orchestrator import run_single, _emit_event

    agent_name = node.get("config", {}).get("agent_name") or node.get("data", {}).get("agent")
    agent = get_agent(agent_name)
    if agent is None:
        await _emit_event(None, task_id, "workflow_node_error",
                          {"node": node.get("id"), "error": f"Agent '{agent_name}' 不存在"},
                          event_queue=event_queue)
        return ""
    prompt = node.get("config", {}).get("prompt") or node.get("data", {}).get("prompt") or ""
    full = f"{ctx_text}\n\n{prompt}".strip() if prompt else ctx_text
    await _emit_event(None, task_id, "workflow_node",
                      {"node": node.get("id"), "type": "agent", "agent": agent.name},
                      event_queue=event_queue)
    return await run_single(task_id, agent, full or "（无输入）", event_queue, user_id)


async def _run_tool_node(node: dict, task_id: str, event_queue, user_id: int) -> str:
    from .orchestrator import _emit_event
    from .tools import execute_tool
    from functools import partial
    from .llm import llm_manager

    cfg = node.get("config", {}) or node.get("data", {}) or {}
    tool_name = cfg.get("tool") or cfg.get("name")
    tool_args = cfg.get("args") or {}
    await _emit_event(None, task_id, "workflow_node",
                      {"node": node.get("id"), "type": "tool", "tool": tool_name},
                      event_queue=event_queue)
    if not tool_name:
        return ""
    # 需要 DB session 的工具（如 create_task）此处无 session，回退
    result_str = await execute_tool(tool_name, tool_args, user_id, session=None)
    return result_str


async def _eval_condition(node: dict, ctx_text: str) -> str:
    """条件节点：用 LLM 判定走哪个分支（返回目标分支标签）。"""
    from .llm import llm_manager
    cfg = node.get("config", {}) or node.get("data", {}) or {}
    expression = cfg.get("expression") or cfg.get("prompt") or ""
    branches = cfg.get("branches") or ["true", "false"]
    try:
        prompt = (
            f"根据上下文判断条件是否成立。\n条件：{expression}\n\n"
            f"上下文：\n{ctx_text[:1000]}\n\n"
            f"只回答其中一个分支标签（从 {branches} 中选），不要解释。"
        )
        resp = await llm_manager.chat(
            [{"role": "system", "content": "你是严谨的条件判定器，只输出分支标签。"},
             {"role": "user", "content": prompt}],
            temperature=0,
        )
        for b in branches:
            if b and b.lower() in resp.lower():
                return b
    except Exception as e:
        logger.warning(f"条件节点判定失败，默认走第一分支: {e}")
    return branches[0] if branches else "true"


async def run_workflow_graph(
    task_id: str,
    nodes: list[dict],
    edges: list[dict],
    user_id: int,
    event_queue,
    agents: list,
    initial_input: str = "",
) -> str:
    """按拓扑遍历执行工作流图，返回最终汇总文本。"""
    from .orchestrator import _emit_event

    board = get_blackboard(task_id, "custom")
    node_map = _index_nodes(nodes)

    def get_agent(name):
        if not name:
            return agents[0] if agents else None
        for a in agents:
            if a.name == name or str(a.id) == str(name):
                return a
        return None

    # 找到 start 节点
    start = next((n for n in nodes if n.get("type") == NODE_START), None)
    if start is None:
        # 没有显式 start → 取第一个 agent/tool 节点
        start = next((n for n in nodes if n.get("type") in (NODE_AGENT, NODE_TOOL)), None)
    if start is None:
        return "工作流为空，无可执行节点。"

    ctx_text = initial_input
    visited: set[str] = set()
    results: list[str] = []

    async def traverse(node_id: str, depth: int = 0) -> str:
        nonlocal ctx_text
        if depth > 50 or node_id in visited:
            return ""
        node = node_map.get(node_id)
        if node is None:
            return ""
        visited.add(node_id)
        ntype = node.get("type")
        out = ""

        if ntype == NODE_AGENT:
            out = await _run_agent_node(node, task_id, event_queue, user_id, ctx_text, get_agent)
            board.write_public(node_id, node_id, out)
        elif ntype == NODE_TOOL:
            out = await _run_tool_node(node, task_id, event_queue, user_id)
            board.write_public(node_id, node_id, out)
        elif ntype == NODE_CONDITION:
            branch = await _eval_condition(node, ctx_text)
            out = f"[condition={branch}]"
            # 只走匹配 label 的边
            for e in _outgoing(edges, node_id):
                if e.get("label") == branch or (branch == "true" and e.get("label") in (None, "", "true")):
                    out += await traverse(e.get("target"), depth + 1)
                elif e.get("label") is None and branch != "false":
                    out += await traverse(e.get("target"), depth + 1)
            return out
        elif ntype in (NODE_PARALLEL, NODE_SEQUENTIAL):
            children = [e.get("target") for e in _outgoing(edges, node_id) if e.get("target")]
            if ntype == NODE_PARALLEL:
                import asyncio
                outs = await asyncio.gather(*[traverse(c, depth + 1) for c in children])
                out = "\n\n---\n\n".join(outs)
            else:
                parts = []
                for c in children:
                    parts.append(await traverse(c, depth + 1))
                out = "\n\n---\n\n".join(parts)
            board.write_public(node_id, node_id, out)
        elif ntype == NODE_END:
            # 出口返回当前累计上下文（各节点接力产出的最新结果），不再依赖 board 的 output 键
            return ctx_text

        # 用本节点输出更新上下文（供下游 agent 节点接力）
        if out:
            ctx_text = out
            results.append(out)

        # 继续沿出边
        for e in _outgoing(edges, node_id):
            tgt = e.get("target")
            if tgt and tgt not in visited:
                cont = await traverse(tgt, depth + 1)
                if cont:
                    results.append(cont)
        return out

    await _emit_event(None, task_id, "workflow_start",
                      {"nodes": len(nodes), "edges": len(edges)},
                      event_queue=event_queue)
    final = await traverse(start.get("id"))

    # 优先用出口/末节点返回的最终产出；退化时再拼接各节点结果，最后回退到初始输入
    return final or "\n\n---\n\n".join(r for r in results if r) or ctx_text
