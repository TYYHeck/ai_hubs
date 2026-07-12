# -*- coding: utf-8 -*-
"""数据集 API — CRUD + 记录管理 + 导入/导出

数据集按用户隔离（user_id）。记录存于 dataset_records 表，供 RAG 检索（见 core/rag.py）。
导入支持 json（对象数组）与 csv（首行表头）；导出同样两种格式。
"""

import csv
import io
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.dataset import Dataset, DatasetRecord
from ...models.user import User
from ...schemas.dataset import (
    DatasetCreate, DatasetResponse, DatasetUpdate,
    DatasetRecordCreate, DatasetRecordResponse,
    DatasetImportRequest, DatasetImportResponse, DatasetExportResponse,
)
from ..deps import get_current_user

router = APIRouter(prefix="/datasets", tags=["Datasets"])


# ── 辅助 ──

async def _recalc_count(session: AsyncSession, dataset_id: int) -> int:
    cnt = (await session.execute(
        select(func.count()).select_from(DatasetRecord).where(DatasetRecord.dataset_id == dataset_id)
    )).scalar_one()
    dataset = await session.get(Dataset, dataset_id)
    if dataset:
        dataset.record_count = cnt
    return cnt


def _to_resp(dataset: Dataset) -> dict:
    # Dataset 的 ORM 属性为 schema_，to_dict() 已映射为 schema，
    # 用 dict 模式构建以避开 from_attributes 的属性名不匹配。
    return DatasetResponse.model_validate(dataset.to_dict()).model_dump()


# ── 数据集 CRUD ──

@router.get("")
async def list_datasets(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Dataset).where(Dataset.user_id == current_user.id).order_by(Dataset.updated_at.desc())
    datasets = (await session.execute(stmt)).scalars().all()
    return [_to_resp(d) for d in datasets]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_dataset(
    data: DatasetCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = Dataset(
        user_id=current_user.id,
        name=data.name,
        description=data.description,
        category=data.category,
        schema_=data.schema_ or {},
        record_count=0,
    )
    session.add(dataset)
    await session.commit()
    await session.refresh(dataset)
    return _to_resp(dataset)


@router.get("/{dataset_id}")
async def get_dataset(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    return _to_resp(dataset)


@router.put("/{dataset_id}")
async def update_dataset(
    dataset_id: int,
    data: DatasetUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key in ("schema", "schema_"):
            dataset.schema_ = value
        else:
            setattr(dataset, key, value)
    await session.commit()
    await session.refresh(dataset)
    return _to_resp(dataset)


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    await session.delete(dataset)  # 级联删除 records
    await session.commit()


# ── 记录管理 ──

@router.get("/{dataset_id}/records")
async def list_records(
    dataset_id: int,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    limit = max(1, min(limit, 1000))
    stmt = select(DatasetRecord).where(DatasetRecord.dataset_id == dataset_id) \
        .order_by(DatasetRecord.id).limit(limit).offset(offset)
    records = (await session.execute(stmt)).scalars().all()
    return [DatasetRecordResponse.model_validate(r.to_dict()).model_dump() for r in records]


@router.post("/{dataset_id}/records", status_code=status.HTTP_201_CREATED)
async def add_record(
    dataset_id: int,
    data: DatasetRecordCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    record = DatasetRecord(dataset_id=dataset_id, data=data.data)
    session.add(record)
    await session.commit()
    await session.refresh(record)
    await _recalc_count(session, dataset_id)
    await session.commit()
    return DatasetRecordResponse.model_validate(record.to_dict()).model_dump()


@router.delete("/{dataset_id}/records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_record(
    dataset_id: int,
    record_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    record = await session.get(DatasetRecord, record_id)
    if not record or record.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="记录不存在")
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    await session.delete(record)
    await session.commit()
    await _recalc_count(session, dataset_id)
    await session.commit()


@router.put("/{dataset_id}/records/{record_id}")
async def update_record(
    dataset_id: int,
    record_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    record = await session.get(DatasetRecord, record_id)
    if not record or record.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    new_data = data.get("data")
    if new_data is None:
        raise HTTPException(status_code=400, detail="缺少 data 字段")
    if not isinstance(new_data, dict):
        raise HTTPException(status_code=400, detail="data 必须是对象")
    
    record.data = new_data
    await session.commit()
    await session.refresh(record)
    return DatasetRecordResponse.model_validate(record.to_dict()).model_dump()


@router.post("/{dataset_id}/records/batch-delete", status_code=status.HTTP_204_NO_CONTENT)
async def batch_delete_records(
    dataset_id: int,
    body: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    
    record_ids = body.get("ids", [])
    if not isinstance(record_ids, list) or not record_ids:
        raise HTTPException(status_code=400, detail="ids 必须是非空数组")
    
    from sqlalchemy import delete as sa_delete
    await session.execute(
        sa_delete(DatasetRecord).where(
            DatasetRecord.dataset_id == dataset_id,
            DatasetRecord.id.in_(record_ids)
        )
    )
    await session.commit()
    await _recalc_count(session, dataset_id)
    await session.commit()


@router.get("/{dataset_id}/records/search")
async def search_records(
    dataset_id: int,
    q: str,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    
    if not q.strip():
        return []
    
    limit = max(1, min(limit, 500))
    stmt = select(DatasetRecord).where(DatasetRecord.dataset_id == dataset_id) \
        .order_by(DatasetRecord.id).limit(limit * 10).offset(offset)
    records = (await session.execute(stmt)).scalars().all()
    
    q_lower = q.lower()
    matched = []
    for r in records:
        data_str = json.dumps(r.data or {}, ensure_ascii=False).lower()
        if q_lower in data_str:
            matched.append(r)
            if len(matched) >= limit:
                break
    
    return [DatasetRecordResponse.model_validate(r.to_dict()).model_dump() for r in matched]


# ── 导入 / 导出 ──

@router.post("/{dataset_id}/import", response_model=DatasetImportResponse)
async def import_records(
    dataset_id: int,
    body: DatasetImportRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")

    rows: list[dict] = []
    if body.format == "json":
        try:
            parsed = json.loads(body.content)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"JSON 解析失败: {e}")
        if not isinstance(parsed, list):
            parsed = [parsed]
        for item in parsed:
            if isinstance(item, dict):
                rows.append(item)
    else:  # csv
        reader = csv.DictReader(io.StringIO(body.content))
        for row in reader:
            # 去掉空字符串键，保留原值
            rows.append({k: v for k, v in row.items() if k})

    inserted = 0
    skipped = 0
    for r in rows:
        if not isinstance(r, dict) or not r:
            skipped += 1
            continue
        session.add(DatasetRecord(dataset_id=dataset_id, data=r))
        inserted += 1
    await session.commit()
    total = await _recalc_count(session, dataset_id)
    await session.commit()
    return DatasetImportResponse(inserted=inserted, skipped=skipped, total_records=total)


@router.get("/{dataset_id}/export", response_model=DatasetExportResponse)
async def export_records(
    dataset_id: int,
    format: str = "json",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dataset = await session.get(Dataset, dataset_id)
    if not dataset or dataset.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="数据集不存在")
    records = (await session.execute(
        select(DatasetRecord).where(DatasetRecord.dataset_id == dataset_id).order_by(DatasetRecord.id)
    )).scalars().all()
    data_list = [r.data for r in records]

    if format == "csv":
        import itertools
        # 收集所有字段名作为表头
        fields: list[str] = []
        for d in data_list:
            for k in d.keys():
                if k not in fields:
                    fields.append(k)
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields)
        writer.writeheader()
        for d in data_list:
            writer.writerow({k: d.get(k, "") for k in fields})
        content = buf.getvalue()
    else:
        content = json.dumps(data_list, ensure_ascii=False, indent=2)

    return DatasetExportResponse(
        dataset_id=dataset_id,
        name=dataset.name,
        format=format,
        content=content,
    )
