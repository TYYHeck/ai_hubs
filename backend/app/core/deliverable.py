# -*- coding: utf-8 -*-
"""
产出验证（消除「假完成」，根因 #4）

依据任务标题/描述推断期望产物扩展名；若任务明确要求某种产物但工作区未生成，
execute_task 会将其标记为 needs_review 而非 completed。

纯函数模块，无外部依赖，便于单元测试独立运行。
"""

from __future__ import annotations

# 关键词 → 期望产物扩展名。描述中包含任一关键词即认为期望该类型产物。
_EXPECTED_EXT_HINTS: dict[tuple[str, ...], set[str]] = {
    (".pptx", "ppt", "演示", "幻灯片", "slides", "汇报"): {".pptx"},
    (".docx", "word", "文档", "报告", "方案", "说明书", "总结", "纪要"): {".docx"},
    (".xlsx", "excel", "表格", "电子表格"): {".xlsx"},
    (".pdf", "pdf"): {".pdf"},
    (".png", "jpg", "jpeg", "图片", "图像", "图表", "海报", "封面", "插画", "绘图", "svg"): {
        ".png", ".jpg", ".jpeg", ".svg"},
    (".html", "网页", "网站", "html", "前端", "页面"): {".html"},
    (".csv", "csv", "数据表"): {".csv"},
    (".py", ".js", "代码", "脚本", "程序"): {".py", ".js"},
}


def _infer_expected_exts(task) -> set[str]:
    """从任务标题/描述推断期望产物扩展名；无法推断返回空集合（走软校验）。"""
    text = f"{getattr(task, 'title', '') or ''} {getattr(task, 'description', '') or ''}".lower()
    if not text.strip():
        return set()
    expected: set[str] = set()
    for hints, exts in _EXPECTED_EXT_HINTS.items():
        if any(h in text for h in hints):
            expected |= exts
    return expected


def _verify_deliverable(task, output_files: list[dict]) -> tuple[bool, str]:
    """验证任务是否真的产出了目标文件。返回 (是否通过, 原因)。

    - 若能从描述推断出明确产物类型：必须生成对应扩展名文件，否则失败。
    - 若无法推断（对话/文本类任务）：有无文件均属正常；仅当存在 0 字节
      空文件时才视为失败（捕捉 write_file 误写空文件 bug）。
    """
    expected = _infer_expected_exts(task)
    have = {f.get("ext", "") for f in output_files}
    if expected:
        if have & expected:
            return True, ""
        names = ", ".join(sorted(expected))
        got = ", ".join(sorted(g for g in have if g)) if any(have) else "无"
        return False, (
            f"任务期望产出 {names} 文件，但工作区未生成。"
            f"（实际产出扩展名：{got}）"
        )
    # 软校验：未从描述推断出明确产物类型 → 视为对话/文本类任务，有无文件均正常；
    # 仅当存在 0 字节空文件时才视为失败（捕捉 write_file 误写空文件 bug）。
    empty = [f["name"] for f in output_files if (f.get("size") or 0) == 0]
    if empty:
        return False, f"存在 {len(empty)} 个 0 字节空文件（{', '.join(empty[:5])}…），产出疑似失败。"
    return True, ""
