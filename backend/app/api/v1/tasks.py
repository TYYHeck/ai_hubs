# -*- coding: utf-8 -*-
"""
任务管理 API — CRUD + 编排执行 + SSE 事件流 + 暂停/恢复
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.orchestrator import (
    execute_task,
    pause_task as _pause_task,
    resume_task as _resume_task,
    register_sse_queue,
    unregister_sse_queue,
    _active_tasks,
)
from ...database import get_session, create_session
from ...models.agent import Agent
from ...models.task import Task, TaskEvent
from ...schemas.task import TaskCreate
from ..deps import get_current_user
from .workflows import get_workflow

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.get("")
async def list_tasks(
    status_filter: str | None = Query(None, alias="status"),
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取任务列表（支持按状态过滤）"""
    stmt = select(Task).where(Task.user_id == current_user.id)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    stmt = stmt.order_by(Task.created_at.desc())
    result = await session.execute(stmt)
    tasks = result.scalars().all()
    
    task_list = []
    for t in tasks:
        item = t.to_dict()
        evt_stmt = select(TaskEvent).where(TaskEvent.task_id == t.id).order_by(TaskEvent.created_at)
        evt_result = await session.execute(evt_stmt)
        events = evt_result.scalars().all()
        item["events"] = [e.to_dict() for e in events]
        item["output_files"] = t.metadata_.get("output_files", [])
        task_list.append(item)
    return task_list


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    data: TaskCreate,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """创建新任务"""
    task_id = uuid.uuid4().hex[:12]

    if data.agent_ids:
        agent_stmt = select(Agent).where(
            Agent.id.in_(data.agent_ids),
            Agent.user_id == current_user.id,
        )
        result = await session.execute(agent_stmt)
        found_agents = result.scalars().all()
        if len(found_agents) != len(data.agent_ids):
            raise HTTPException(status_code=400, detail="部分 Agent 不存在或不属于你")

    # 议题 #6：前端选中具体工作流后统一以 workflow 模式运行（即便模式下拉不是 workflow）
    _mode = data.mode
    if data.workflow_id and _mode != "workflow":
        _mode = "workflow"

    task = Task(
        id=task_id,
        user_id=current_user.id,
        title=data.title,
        description=data.description,
        mode=_mode,
        think_depth=data.think_depth,
        think_visibility=data.think_visibility,
        priority=data.priority,
        tags=data.tags or [],
        metadata_={
            "agent_ids": data.agent_ids,
            "pipeline_steps": data.pipeline_steps,
            "assignment": data.assignment,
        },
    )
    # ── mode=workflow：按名字选用具体工作流，注入节点/边（议题 #11 落地联动）──
    if _mode == "workflow":
        if not data.workflow_id:
            raise HTTPException(status_code=400, detail="请先选择要运行的具体工作流")
        wf = get_workflow(data.workflow_id)
        if not wf:
            raise HTTPException(status_code=404, detail="工作流不存在或已被删除")
        task.metadata_["workflow_nodes"] = wf.get("nodes", [])
        task.metadata_["workflow_edges"] = wf.get("edges", [])
        task.metadata_["workflow_id"] = wf["id"]
        task.metadata_["workflow_name"] = wf.get("name", "")
    # ── mode=auto：限制 AI 可复用的具体工作流（空=全部）──
    if data.allowed_workflows:
        task.metadata_["allowed_workflows"] = data.allowed_workflows
    session.add(task)
    await session.commit()
    return task.to_dict()


@router.get("/modes")
async def list_modes(current_user=Depends(get_current_user)):
    """列出所有编排模式及其说明"""
    modes = [
        {"id": "single", "name": "单 Agent", "desc": "单个 Agent 独立执行任务", "icon": "user"},
        {"id": "sequential", "name": "串行", "desc": "Agent 依次执行，前一个输出作为后一个输入", "icon": "arrow-right"},
        {"id": "parallel", "name": "并行", "desc": "多个 Agent 同时执行，汇总结果", "icon": "git-branch"},
        {"id": "debate", "name": "辩论", "desc": "Agent 辩论交锋，互相质疑后综合结论", "icon": "message-square"},
        {"id": "vote", "name": "投票", "desc": "各 Agent 投票，多数决议", "icon": "check-square"},
        {"id": "hierarchical", "name": "层级", "desc": "主管 Agent 分解任务，委派成员执行，汇总交付", "icon": "git-merge"},
        {"id": "swarm", "name": "群体自组织", "desc": "Agent 共享上下文，自选子任务协作", "icon": "share-2"},
        {"id": "custom", "name": "自定义流水线", "desc": "按指定顺序串行执行，每个步骤可指定 Agent", "icon": "sliders"},
        {"id": "peer_review", "name": "同行评审", "desc": "多 Agent 出初稿 → 评审者逐一点评 → 作者修订 → 汇总终稿", "icon": "check-circle"},
        {"id": "round_table", "name": "圆桌讨论", "desc": "主持人引导 + 参与者轮流发言，动态收敛提前结束", "icon": "users"},
        {"id": "workflow", "name": "工作流", "desc": "按 WorkflowNode 图拓扑执行（agent/tool/condition/parallel/sequential）", "icon": "workflow"},
        {"id": "auto", "name": "自动工作流", "desc": "按任务内容自动指派最合适 Agent 与编排模式（覆盖全部 8+ 模式，支持直接匹配或 AI 分析）", "icon": "sparkles"},
    ]
    return modes


@router.get("/{task_id}")
async def get_task_detail(
    task_id: str,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取任务详情（含事件日志）"""
    task = await session.get(Task, task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="任务不存在")

    evt_stmt = select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.created_at)
    evt_result = await session.execute(evt_stmt)
    events = evt_result.scalars().all()

    agent_ids = task.metadata_.get("agent_ids", [])
    agents_info = []
    if agent_ids:
        agent_stmt = select(Agent).where(Agent.id.in_(agent_ids))
        ar = await session.execute(agent_stmt)
        agents_info = [{"id": a.id, "name": a.name, "model": a.model} for a in ar.scalars().all()]

    detail = task.to_dict(full=True)
    detail["events"] = [e.to_dict() for e in events]
    detail["agents"] = agents_info
    # 附加任务产出的文件列表
    detail["output_files"] = task.metadata_.get("output_files", [])
    return detail


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除任务"""
    task = await session.get(Task, task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="任务不存在")
    await session.delete(task)
    await session.commit()


@router.post("/{task_id}/execute")
async def execute(
    task_id: str,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """开始执行任务（异步后台，通过 SSE 获取实时事件）"""
    task = await session.get(Task, task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status in ("running",):
        raise HTTPException(status_code=400, detail="任务正在运行中")

    agent_ids = task.metadata_.get("agent_ids", [])
    pipeline_steps = task.metadata_.get("pipeline_steps")
    assignment = task.metadata_.get("assignment", "direct")

    queue: asyncio.Queue = asyncio.Queue()
    asyncio.create_task(
        _run_and_collect(task_id, agent_ids, pipeline_steps, current_user.id, queue, assignment)
    )

    return {"task_id": task_id, "status": "started"}


@router.get("/{task_id}/stream")
async def stream_events(
    task_id: str,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """SSE 事件流 — 实时推送任务执行事件"""
    task = await session.get(Task, task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="任务不存在")

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        register_sse_queue(task_id, queue)

        try:
            async with create_session() as s:
                evt_stmt = select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.created_at)
                result = await s.execute(evt_stmt)
                for evt in result.scalars().all():
                    d = evt.to_dict()
                    yield f"data: {json.dumps(d, ensure_ascii=False)}\n\n"

            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield f": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            unregister_sse_queue(task_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _run_and_collect(
    task_id: str,
    agent_ids: list[int],
    pipeline_steps: list[str] | None,
    user_id: int,
    event_queue: asyncio.Queue,
    assignment: str = "direct",
):
    """后台执行任务，收集事件到队列"""
    try:
        await execute_task(
            task_id=task_id,
            event_queue=event_queue,
            user_id=user_id,
            agent_ids=agent_ids,
            pipeline_steps=pipeline_steps,
            assignment=assignment,
        )
    except Exception as e:
        import logging as _logging
        _logging.getLogger("ai_hubs.tasks").exception(f"任务执行异常 task_id={task_id}: {e}")
        await event_queue.put({
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "event": "task_error",
            "data": {"error": str(e)},
        })


@router.post("/{task_id}/pause")
async def pause(
    task_id: str,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """暂停任务"""
    task = await session.get(Task, task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="任务不存在")

    ok = _pause_task(task_id)
    if ok:
        t = await session.get(Task, task_id)
        if t:
            t.status = "paused"
            await session.commit()
        return {"task_id": task_id, "status": "paused"}
    return {"task_id": task_id, "status": "not_running"}


@router.post("/{task_id}/resume")
async def resume(
    task_id: str,
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """恢复任务"""
    task = await session.get(Task, task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="任务不存在")

    ok = _resume_task(task_id)
    if ok:
        t = await session.get(Task, task_id)
        if t:
            t.status = "running"
            await session.commit()
        return {"task_id": task_id, "status": "resumed"}
    return {"task_id": task_id, "status": "not_paused"}
