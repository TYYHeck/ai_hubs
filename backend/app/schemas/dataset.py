# -*- coding: utf-8 -*-
"""数据集 Pydantic 模型 — CRUD / 记录 / 导入 / 导出"""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class DatasetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    category: str = "general"
    schema_: dict = Field(default_factory=dict, alias="schema")   # 字段定义（元信息）

    model_config = ConfigDict(populate_by_name=True)


class DatasetUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    category: Optional[str] = None
    schema_: Optional[dict] = Field(None, alias="schema")

    model_config = ConfigDict(populate_by_name=True)


class DatasetResponse(BaseModel):
    id: int
    name: str
    description: str
    category: str
    schema: dict = {}
    record_count: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class DatasetRecordCreate(BaseModel):
    data: dict = Field(..., description="字段名→值 的字典")


class DatasetRecordResponse(BaseModel):
    id: int
    dataset_id: int
    data: dict = {}
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class DatasetImportRequest(BaseModel):
    """批量导入：支持 json（对象数组）或 csv（首行为表头）"""
    format: str = Field(default="json", pattern=r"^(json|csv)$")
    content: str = Field(..., min_length=1)


class DatasetImportResponse(BaseModel):
    inserted: int
    skipped: int
    total_records: int


class DatasetExportResponse(BaseModel):
    dataset_id: int
    name: str
    format: str
    content: str
