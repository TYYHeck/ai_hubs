# -*- coding: utf-8 -*-
"""
一次性数据清理脚本：把历史脏存的 assistant 消息中嵌入的 [工具: ...] 行去掉。

历史背景：早期 chat.py 会把 tool_result 拼到 assistant 文本里，导致数据库里
出现了形如：
  ... 好的我帮你... [工具: call_internal_api] {"ok":true,"data":{...}} ...
这种内容。本脚本扫描所有 assistant 消息，移除 `[工具: ...]` 开头到行尾的部分。

用法（在 backend 目录下）：
  /root/ai_hubs/venv/bin/python -m scripts.clean_tool_leakage
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

# 允许作为脚本运行
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app import database as db_mod  # noqa: E402
from app.models.conversation import Message  # noqa: E402

# 匹配 "\n[工具: name]\n...任意非空内容直到下一个 \n[工具: 或字符串结尾"
# 简化版：把所有以 "[工具:" 开头、直到下一个 "\n[工具:" 或字符串末尾之间的内容（包含前置 \n）都删除
# 匹配两种历史脏数据格式：
# 1. 老格式：[工具: name]\n{...json...}\n
# 2. 新格式：\n{"ok": true, "status": 200, "data": {...}}（LLM 把 tool_result 当成自己的话复读了一遍）
TOOL_LEAK_RE = re.compile(
    r"\n?\[工具:[^\]]*\][\s\S]*?(?=\n\[工具:|$)"  # 老格式
)


def remove_json_blocks(text: str) -> str:
    """移除所有以 '{"ok": true' 开头、独立成段的 JSON 块（brace 平衡匹配）

    这种格式是 LLM 把 call_internal_api 工具的 JSON 响应复读进自己的 assistant 文本。
    匹配后保留非 JSON 文本，JSON 块用空字符串替换。
    """
    result = []
    i = 0
    while i < len(text):
        # 查找下一个可能的 JSON 块起点
        m = re.search(r'(?:^|\n)\{"ok"\s*:\s*true', text[i:])
        if not m:
            result.append(text[i:])
            break
        start = i + m.start()
        # 起点前的文本（保留换行符）
        if m.start() > 0:
            result.append(text[i:start])
        # 从 { 开始扫描 brace 平衡
        depth = 0
        j = start
        in_string = False
        escape = False
        while j < len(text):
            ch = text[j]
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = not in_string
            elif not in_string:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        j += 1
                        # 跳过尾部换行
                        if j < len(text) and text[j] == '\n':
                            j += 1
                        break
            j += 1
        i = j
    return ''.join(result).rstrip()


async def main() -> None:
    # 确保数据库引擎已初始化
    if db_mod._session_factory is None:
        print("[clean] init_database() ...", flush=True)
        await db_mod.init_database()
    factory = db_mod._session_factory
    if factory is None:
        raise RuntimeError("init_database() did not create a session factory. Check config.yaml.")
    async with factory() as session:
        result = await session.execute(select(Message).where(Message.role == "assistant"))
        messages = result.scalars().all()
        print(f"[clean] found {len(messages)} assistant messages to scan")
        cleaned = 0
        for msg in messages:
            original = msg.content or ""
            if "[工具:" not in original and '"ok"' not in original and '"interactive"' not in original:
                continue
            new_content = TOOL_LEAK_RE.sub("", original)
            new_content = remove_json_blocks(new_content)
            new_content = new_content.rstrip()
            if new_content != original:
                msg.content = new_content
                cleaned += 1
        if cleaned > 0:
            await session.commit()
        print(f"[clean] cleaned {cleaned} messages")


if __name__ == "__main__":
    asyncio.run(main())
