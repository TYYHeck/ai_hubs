# -*- coding: utf-8 -*-
"""工作流 API — CRUD + 执行"""

import asyncio
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.task import Task
from ..deps import get_current_user

router = APIRouter(prefix="/workflows", tags=["Workflows"])

_workflows = []
_next_id = 1


@router.get("")
async def api_list_workflows(current_user = Depends(get_current_user)):
    return _workflows


@router.post("")
async def api_create_workflow(data: dict, current_user = Depends(get_current_user)):
    global _next_id
    wf = {
        "id": str(_next_id),
        "name": data.get("name", "未命名工作流"),
        "description": data.get("description", ""),
        "nodes": data.get("nodes", []),
        "edges": data.get("edges", []),
        "status": "pending",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    _next_id += 1
    _workflows.append(wf)
    return wf


@router.post("/{wf_id}/execute")
async def api_execute_workflow(
    wf_id: str,
    current_user = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """真正执行自定义工作流（议题 #11）：创建 workflow 模式的后台任务并运行 Graph Runner。"""
    wf = next((w for w in _workflows if w["id"] == wf_id), None)
    if not wf:
        raise HTTPException(status_code=404, detail="工作流不存在")

    wf["status"] = "running"

    task_id = uuid.uuid4().hex[:12]
    task = Task(
        id=task_id,
        user_id=current_user.id,
        title=wf.get("name", "未命名工作流"),
        description=wf.get("description", ""),
        status="pending",
        mode="workflow",
        priority=5,
        tags=["workflow"],
        metadata_={
            "workflow_nodes": wf.get("nodes", []),
            "workflow_edges": wf.get("edges", []),
            "workflow_id": wf_id,
        },
    )
    session.add(task)
    await session.commit()

    queue: asyncio.Queue = asyncio.Queue()
    asyncio.create_task(_bg_run_workflow(task_id, current_user.id, queue))

    return {"ok": True, "workflow": wf, "task_id": task_id}


async def _bg_run_workflow(task_id: str, user_id: int, queue: asyncio.Queue) -> None:
    """后台执行工作流任务（复用 orchestrator.execute_task 的 quota/快照/用量逻辑）。"""
    try:
        from ...core.orchestrator import execute_task
        await execute_task(
            task_id=task_id,
            event_queue=queue,
            user_id=user_id,
            agent_ids=None,        # 由工作流节点内 agent_name 自行匹配
            pipeline_steps=None,
            assignment="direct",
        )
    except Exception as e:
        import logging
        logging.getLogger("ai_hubs.workflows").error(f"工作流任务执行异常: {e}", exc_info=True)


@router.delete("/{wf_id}")
async def api_delete_workflow(wf_id: str, current_user = Depends(get_current_user)):
    global _workflows
    _workflows = [w for w in _workflows if w["id"] != wf_id]
    return {"ok": True}


@router.put("/{wf_id}")
async def api_update_workflow(wf_id: str, data: dict, current_user = Depends(get_current_user)):
    for wf in _workflows:
        if wf["id"] == wf_id:
            wf["name"] = data.get("name", wf["name"])
            wf["description"] = data.get("description", wf["description"])
            wf["nodes"] = data.get("nodes", wf["nodes"])
            wf["edges"] = data.get("edges", wf["edges"])
            wf["updated_at"] = datetime.now().isoformat()
            return wf
    raise HTTPException(status_code=404, detail="工作流不存在")


# ── AI 生成工作流 ──────────────────────────────────────────

@router.post("/ai/generate")
async def api_ai_generate_workflow(data: dict, current_user = Depends(get_current_user)):
    """AI 根据名称和描述生成工作流节点"""
    from ...core.llm import llm_manager

    name = data.get("name", "")
    description = data.get("description", "")

    if not name and not description:
        raise HTTPException(status_code=400, detail="请提供工作流名称或描述")

    system_prompt = """你是一个工作流设计专家。用户会给你一个工作流的名称和描述，你需要分析需求并设计一个合理的工作流。

可用的节点类型：
- start: 开始节点（每个工作流有且只有一个）
- end: 结束节点（每个工作流有且只有一个）
- agent: Agent 节点，用于执行具体任务（可以指定 agent_id 或留空让 AI 自动分配）
- tool: 工具节点，用于调用特定工具
- condition: 条件分支节点，根据条件判断走不同路径
- parallel: 并行执行节点，多个任务同时执行
- sequential: 串行执行节点，多个任务按顺序执行

设计原则：
1. 工作流必须以 start 开始，以 end 结束
2. 节点数量根据任务复杂度决定，一般 3-8 个节点比较合理
3. 每个节点要有清晰的 label 和合理的配置
4. agent 节点的 agent_id 可以留空（表示自动分配），也可以指定具体 ID
5. 节点之间通过 next 字段连接，用节点 ID 列表表示

请严格按照以下 JSON 格式返回，不要有任何额外的解释文字：
{
  "nodes": [
    {"id": "start", "type": "start", "label": "开始", "next": ["node1_id"]},
    {"id": "node1_id", "type": "agent", "label": "节点名称", "next": ["end"], "agent_id": null}
  ],
  "edges": [
    {"from": "start", "to": "node1_id"}
  ]
}"""

    user_prompt = f"""请根据以下信息设计工作流：

工作流名称：{name}
工作流描述：{description}

请设计一个合理的工作流，包含合适的节点和连线。确保节点 ID 是有意义的英文标识（如 analyze_task, write_code, review_result 等），不要用数字编号。"""

    try:
        result = await llm_manager.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
        )

        # 尝试解析 JSON
        json_str = result.strip()
        # 去掉可能的 markdown 代码块标记
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0].strip()
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0].strip()

        workflow_data = json.loads(json_str)
        nodes = workflow_data.get("nodes", [])
        edges = workflow_data.get("edges", [])

        # 验证：必须有 start 和 end 节点
        has_start = any(n["type"] == "start" for n in nodes)
        has_end = any(n["type"] == "end" for n in nodes)

        if not has_start:
            nodes.insert(0, {"id": "start", "type": "start", "label": "开始",
                             "next": [nodes[0]["id"]] if nodes else ["end"]})
        if not has_end:
            nodes.append({"id": "end", "type": "end", "label": "结束"})
            if nodes and len(nodes) > 1:
                nodes[-2]["next"] = ["end"]

        # 如果 edges 为空，根据 nodes 的 next 字段生成
        if not edges:
            edges = []
            for n in nodes:
                for next_id in (n.get("next") or []):
                    edges.append({"from": n["id"], "to": next_id})

        return {
            "name": name,
            "description": description,
            "nodes": nodes,
            "edges": edges,
        }

    except Exception as e:
        # 如果 AI 生成失败，返回一个简单的默认工作流
        default_nodes = [
            {"id": "start", "type": "start", "label": "开始", "next": ["agent_1"]},
            {"id": "agent_1", "type": "agent", "label": name or "执行任务", "next": ["end"]},
            {"id": "end", "type": "end", "label": "结束"},
        ]
        return {
            "name": name,
            "description": description,
            "nodes": default_nodes,
            "edges": [{"from": "start", "to": "agent_1"}, {"from": "agent_1", "to": "end"}],
        }
