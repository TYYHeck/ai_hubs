# -*- coding: utf-8 -*-
"""数据集管理路由 —— CRUD + 导入导出"""

from __future__ import annotations
from fastapi import APIRouter, Query, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/datasets", tags=["数据集管理"])


class CreateDatasetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    category: str = "custom"
    tags: list[str] = []
    metadata: dict = {}


class ImportDataRequest(BaseModel):
    content: str = Field(..., description="导入的数据内容")
    format: str = Field("auto", description="数据格式: auto/json/csv/text")


class AddRecordsRequest(BaseModel):
    records: list[dict] = Field(..., description="追加的记录列表")


@router.get("/list")
async def list_datasets(category: str = Query("", description="分类筛选")):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    datasets = mgr.list_all(category)
    return {"ok": True, "datasets": datasets, "categories": mgr.categories()}


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    ds = mgr.get(dataset_id)
    if not ds:
        return JSONResponse({"ok": False, "error": "数据集不存在"}, status_code=404)
    return {"ok": True, "dataset": ds}


@router.post("/create")
async def create_dataset(req: CreateDatasetRequest):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    ds = mgr.create(
        name=req.name,
        description=req.description,
        category=req.category,
        tags=req.tags,
        metadata=req.metadata,
    )
    return {"ok": True, "dataset": ds}


@router.post("/{dataset_id}/import")
async def import_data(dataset_id: str, req: ImportDataRequest):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    result = mgr.import_data(dataset_id, req.content, req.format)
    if not result.get("ok"):
        return JSONResponse(result, status_code=400)
    return result


@router.post("/{dataset_id}/import-file")
async def import_file(dataset_id: str, file: UploadFile = File(...)):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    try:
        content = await file.read()
        text = content.decode("utf-8")
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"读取文件失败: {e}"}, status_code=400)
    result = mgr.import_data(dataset_id, text, "auto")
    if not result.get("ok"):
        return JSONResponse(result, status_code=400)
    return result


@router.get("/{dataset_id}/records")
async def get_records(
    dataset_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    result = mgr.get_records(dataset_id, offset, limit)
    if not result.get("ok"):
        return JSONResponse(result, status_code=404)
    return result


@router.post("/{dataset_id}/records")
async def add_records(dataset_id: str, req: AddRecordsRequest):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    result = mgr.add_records(dataset_id, req.records)
    if not result.get("ok"):
        return JSONResponse(result, status_code=400)
    return result


@router.put("/{dataset_id}")
async def update_dataset(dataset_id: str, updates: dict):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    allowed = {"name", "description", "category", "tags", "metadata"}
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if mgr.update(dataset_id, **filtered):
        ds = mgr.get(dataset_id)
        return {"ok": True, "dataset": ds}
    return JSONResponse({"ok": False, "error": "数据集不存在"}, status_code=404)


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: str):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    if mgr.delete(dataset_id):
        return {"ok": True, "message": "数据集已删除"}
    return JSONResponse({"ok": False, "error": "数据集不存在"}, status_code=404)


@router.get("/{dataset_id}/export")
async def export_dataset(dataset_id: str, format: str = Query("json", description="导出格式: json/csv")):
    from src.datasets import get_dataset_manager
    mgr = get_dataset_manager()
    content = mgr.export(dataset_id, format)
    if content is None:
        return JSONResponse({"ok": False, "error": "数据集不存在"}, status_code=404)
    return {"ok": True, "format": format, "content": content}
