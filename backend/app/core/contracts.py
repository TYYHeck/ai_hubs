# -*- coding: utf-8 -*-
"""
结构化契约（议题 #6）— 让 Agent 间传递的数据可校验、可程序化消费。

设计：对"需要被程序消费或接力"的产出做强 schema 校验，纯文本自由创作保持原样。
- `extract_structured`：从 Agent 文本产出中解析出结构化 dict（兼容 ```json 代码块 / 纯 JSON / YAML 风格）。
- `validate_contract`：校验必填字段与基本类型。
- `format_for_next`：把结构化结果格式化为下游 Agent 易消费的文本。

与 §7 质量门控、§3 工具提示联动：stage 若声明 expected_output 字段，Orchestrator 在写回黑板前做校验。
"""

from __future__ import annotations

import json
import re
from typing import Any

# 预置常用"关键节点" schema（字段名 -> 期望类型）
SCHEMAS: dict[str, dict[str, type]] = {
    "SolutionSet": {"solutions": list, "summary": str},
    "AnalysisReport": {"findings": list, "conclusion": str},
    "ReviewReport": {"score": (int, float), "passed": bool, "comments": str},
    "Decision": {"decision": str, "reason": str},
    "Plan": {"steps": list, "owner": str},
}


def extract_structured(text: str) -> tuple[dict | None, str | None]:
    """从 Agent 文本产出中尝试解析结构化 dict。

    返回 (parsed_dict, error)。解析失败返回 (None, error_msg)。
    支持：```json 代码块、裸 JSON 对象、行首 'key: value' 紧凑结构（退化为 None）。
    """
    if not text:
        return None, "空产出"
    # 1) ```json ... ``` 代码块
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = m.group(1) if m else None
    # 2) 裸 JSON 对象（首尾花括号）
    if candidate is None:
        s = text.find("{")
        e = text.rfind("}")
        if s != -1 and e != -1 and e > s:
            candidate = text[s:e + 1]
    if candidate is None:
        return None, "未找到结构化 JSON 片段"
    try:
        obj = json.loads(candidate)
    except json.JSONDecodeError as e:
        return None, f"JSON 解析失败: {e}"
    if not isinstance(obj, dict):
        return None, "解析结果非对象"
    return obj, None


def validate_contract(obj: dict, schema_name: str | None, required_fields: list[str] | None) -> tuple[bool, str | None]:
    """校验结构化产出是否满足契约。

    schema_name：SCHEMAS 中的预置 schema 名（可选）。
    required_fields：额外必填字段（可选）。
    返回 (ok, error)。
    """
    if schema_name:
        schema = SCHEMAS.get(schema_name)
        if schema is None:
            return False, f"未知 schema: {schema_name}"
        for fname, ftype in schema.items():
            if fname not in obj:
                return False, f"缺少字段: {fname}"
            if not isinstance(obj[fname], ftype):
                return False, f"字段 {fname} 类型错误，期望 {ftype.__name__}"
    if required_fields:
        for f in required_fields:
            if f not in obj:
                return False, f"缺少必填字段: {f}"
    return True, None


def format_for_next(obj: dict, label: str = "阶段产出") -> str:
    """把结构化结果格式化为下游 Agent 易消费的文本。"""
    try:
        json_str = json.dumps(obj, ensure_ascii=False, indent=2)
    except Exception:
        json_str = str(obj)
    return f"【{label}（结构化）】\n```json\n{json_str}\n```"
