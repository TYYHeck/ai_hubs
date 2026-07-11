# -*- coding: utf-8 -*-
"""工作流 API — CRUD + 执行"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

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
async def api_execute_workflow(wf_id: str, current_user = Depends(get_current_user)):
    for wf in _workflows:
        if wf["id"] == wf_id:
            wf["status"] = "running"
            return {"ok": True, "workflow": wf}
    raise HTTPException(status_code=404, detail="工作流不存在")


@router.delete("/{wf_id}")
async def api_delete_workflow(wf_id: str, current_user = Depends(get_current_user)):
    global _workflows
    _workflows = [w for w in _workflows if w["id"] != wf_id]
    return {"ok": True}
