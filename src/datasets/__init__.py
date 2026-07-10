# -*- coding: utf-8 -*-
"""
数据集管理 —— 结构化数据的 CRUD、分类、导入导出

支持格式: JSON / CSV / 纯文本
分类系统: 训练数据 / 测试数据 / 提示词模板 / 知识问答 / 自定义
"""

from __future__ import annotations
import json
import os
import csv
import io
import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

logger = logging.getLogger("ai_hubs.datasets")

DATASETS_DIR = "./data/datasets"


@dataclass
class Dataset:
    id: str
    name: str
    description: str = ""
    category: str = "custom"  # training/test/prompts/qa/custom
    format: str = "json"       # json/csv/text
    records_count: int = 0
    file_size: int = 0
    tags: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "format": self.format,
            "records_count": self.records_count,
            "file_size": self.file_size,
            "tags": self.tags,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
        }


CATEGORIES = {
    "training": "训练数据",
    "test": "测试数据",
    "prompts": "提示词模板",
    "qa": "知识问答",
    "custom": "自定义",
}


class DatasetManager:
    """数据集管理器"""

    def __init__(self, datasets_dir: str = DATASETS_DIR):
        self.datasets_dir = datasets_dir
        self.index_path = os.path.join(datasets_dir, "index.json")
        self._datasets: dict[str, Dataset] = {}
        os.makedirs(datasets_dir, exist_ok=True)
        self._load_index()

    def _load_index(self):
        """加载索引"""
        if os.path.exists(self.index_path):
            try:
                with open(self.index_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    ds = Dataset(**item)
                    self._datasets[ds.id] = ds
                logger.info(f"加载了 {len(self._datasets)} 个数据集")
            except Exception as e:
                logger.error(f"加载数据集索引失败: {e}")

    def _save_index(self):
        """保存索引"""
        with open(self.index_path, "w", encoding="utf-8") as f:
            json.dump([ds.to_dict() for ds in self._datasets.values()], f, ensure_ascii=False, indent=2)

    def _dataset_path(self, dataset_id: str) -> str:
        return os.path.join(self.datasets_dir, dataset_id)

    # ── CRUD ──

    def list_all(self, category: str = "") -> list[dict]:
        result = list(self._datasets.values())
        if category:
            result = [ds for ds in result if ds.category == category]
        return [ds.to_dict() for ds in sorted(result, key=lambda d: d.updated_at, reverse=True)]

    def get(self, dataset_id: str) -> Optional[dict]:
        ds = self._datasets.get(dataset_id)
        return ds.to_dict() if ds else None

    def create(self, name: str, description: str = "", category: str = "custom",
               tags: list[str] = None, metadata: dict = None) -> dict:
        """创建空数据集"""
        ds_id = f"ds_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        now = datetime.now().isoformat()

        ds = Dataset(
            id=ds_id,
            name=name,
            description=description,
            category=category if category in CATEGORIES else "custom",
            format="json",
            records_count=0,
            tags=tags or [],
            created_at=now,
            updated_at=now,
            metadata=metadata or {},
        )
        self._datasets[ds_id] = ds
        # 创建空数据文件
        os.makedirs(self._dataset_path(ds_id), exist_ok=True)
        with open(os.path.join(self._dataset_path(ds_id), "data.json"), "w", encoding="utf-8") as f:
            json.dump([], f)
        self._save_index()
        return ds.to_dict()

    def import_data(self, dataset_id: str, content: str, format: str = "auto") -> dict:
        """
        导入数据到数据集

        支持格式: JSON / CSV / 纯文本(每行一条)
        """
        ds = self._datasets.get(dataset_id)
        if not ds:
            return {"ok": False, "error": "数据集不存在"}

        records = []

        if format == "auto":
            content_stripped = content.strip()
            if content_stripped.startswith("["):
                format = "json"
            elif "," in content_stripped.split("\n")[0] and "\t" not in content_stripped.split("\n")[0]:
                format = "csv"
            else:
                format = "text"

        try:
            if format == "json":
                data = json.loads(content)
                if isinstance(data, list):
                    records = data
                elif isinstance(data, dict):
                    records = [data]
            elif format == "csv":
                reader = csv.DictReader(io.StringIO(content))
                records = list(reader)
            elif format == "text":
                records = [{"text": line.strip()} for line in content.split("\n") if line.strip()]
        except Exception as e:
            return {"ok": False, "error": f"解析失败: {e}"}

        if not records:
            return {"ok": False, "error": "未解析到有效数据"}

        # 保存数据文件
        data_path = os.path.join(self._dataset_path(dataset_id), "data.json")
        with open(data_path, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)

        ds.records_count = len(records)
        ds.file_size = os.path.getsize(data_path)
        ds.format = format
        ds.updated_at = datetime.now().isoformat()
        self._save_index()

        return {"ok": True, "records_count": len(records), "dataset": ds.to_dict()}

    def get_records(self, dataset_id: str, offset: int = 0, limit: int = 50) -> dict:
        """获取数据集记录"""
        ds = self._datasets.get(dataset_id)
        if not ds:
            return {"ok": False, "error": "数据集不存在"}

        data_path = os.path.join(self._dataset_path(dataset_id), "data.json")
        if not os.path.exists(data_path):
            return {"ok": True, "records": [], "total": 0}

        with open(data_path, "r", encoding="utf-8") as f:
            records = json.load(f)

        total = len(records)
        page = records[offset:offset + limit]

        return {"ok": True, "records": page, "total": total, "offset": offset, "limit": limit}

    def add_records(self, dataset_id: str, new_records: list[dict]) -> dict:
        """追加记录"""
        ds = self._datasets.get(dataset_id)
        if not ds:
            return {"ok": False, "error": "数据集不存在"}

        data_path = os.path.join(self._dataset_path(dataset_id), "data.json")
        existing = []
        if os.path.exists(data_path):
            with open(data_path, "r", encoding="utf-8") as f:
                existing = json.load(f)

        existing.extend(new_records)
        with open(data_path, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)

        ds.records_count = len(existing)
        ds.file_size = os.path.getsize(data_path)
        ds.updated_at = datetime.now().isoformat()
        self._save_index()

        return {"ok": True, "added": len(new_records), "total": len(existing)}

    def update(self, dataset_id: str, **kwargs) -> bool:
        """更新数据集元信息"""
        ds = self._datasets.get(dataset_id)
        if not ds:
            return False
        for k, v in kwargs.items():
            if hasattr(ds, k):
                setattr(ds, k, v)
        ds.updated_at = datetime.now().isoformat()
        self._save_index()
        return True

    def delete(self, dataset_id: str) -> bool:
        """删除数据集"""
        if dataset_id not in self._datasets:
            return False
        import shutil
        path = self._dataset_path(dataset_id)
        if os.path.exists(path):
            shutil.rmtree(path)
        del self._datasets[dataset_id]
        self._save_index()
        return True

    def export(self, dataset_id: str, format: str = "json") -> Optional[str]:
        """导出数据集"""
        ds = self._datasets.get(dataset_id)
        if not ds:
            return None

        data_path = os.path.join(self._dataset_path(dataset_id), "data.json")
        if not os.path.exists(data_path):
            return "[]"

        with open(data_path, "r", encoding="utf-8") as f:
            records = json.load(f)

        if format == "csv" and records:
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=records[0].keys())
            writer.writeheader()
            writer.writerows(records)
            return output.getvalue()

        return json.dumps(records, ensure_ascii=False, indent=2)

    def categories(self) -> list[dict]:
        """分类统计"""
        counts: dict[str, int] = {}
        for ds in self._datasets.values():
            counts[ds.category] = counts.get(ds.category, 0) + 1
        return [
            {"id": cid, "name": CATEGORIES.get(cid, cid), "count": counts.get(cid, 0)}
            for cid in CATEGORIES
        ]


# 单例
_manager: Optional[DatasetManager] = None


def get_dataset_manager() -> DatasetManager:
    global _manager
    if _manager is None:
        _manager = DatasetManager()
    return _manager
