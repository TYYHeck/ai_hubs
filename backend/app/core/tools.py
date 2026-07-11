# -*- coding: utf-8 -*-
"""
Agent 工具层 — OpenAI Function Calling 兼容的工具定义与执行调度

提供 5 个标准工具：
  run_code     — 在沙箱中执行代码（python/js/bash/c/cpp/java）
  run_terminal — 在沙箱中执行终端命令
  read_file    — 读取工作区文件
  write_file   — 写入工作区文件
  list_files   — 列出工作区目录

所有工具经过 sandbox 模块执行，共享路径越界防护、配额限制与超时控制。
"""

from __future__ import annotations

import json
import logging

from .sandbox import run_code, run_terminal, read_file, write_file, list_files

logger = logging.getLogger("ai_hubs.tools")

# ═══════════════════════════════════════════════════════════
# 工具定义（OpenAI function calling 格式）
# ═══════════════════════════════════════════════════════════

TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "run_code",
            "description": (
                "在隔离沙箱中编写并执行一段代码。支持 Python、JavaScript(Node)、Bash、C、C++、Java。"
                "执行结果包含 stdout、stderr 和退出码。代码被写入临时文件后运行，超时 30 秒自动终止。"
                "如需持久化文件，请先用 write_file 写入。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {
                        "type": "string",
                        "enum": ["python", "javascript", "bash", "c", "cpp", "java"],
                        "description": "编程语言类型",
                    },
                    "code": {
                        "type": "string",
                        "description": "要执行的完整源代码",
                    },
                    "args": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "命令行参数列表（可选）",
                    },
                },
                "required": ["language", "code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_terminal",
            "description": (
                "在用户的沙箱工作区内执行一条终端命令（bash）。可用于安装依赖包、"
                "管理文件、查看环境信息等。命令在受限工作区根目录执行。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的 bash 命令（单条或多条用 && 连接）",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "相对于工作区根目录的工作子目录，空表示根目录",
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "读取用户沙箱工作区中指定文件的内容。返回文件名、大小和文本内容。"
                "仅能访问当前用户的工作区，无法读取他人文件。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "相对于工作区根目录的文件路径，例如 'src/main.py'",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "将文本内容写入用户沙箱工作区的指定路径。会自动创建父目录。"
                "受 500MB 用户配额限制。写入后可使用 run_code 或 run_terminal 执行该文件。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件相对路径，例如 'hello.py' 或 'src/utils.sh'",
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入文件的完整文本内容",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": (
                "列出用户沙箱工作区中指定目录的内容。返回文件名、类型（文件/目录）、大小。"
                "用于了解工作区中已有文件结构。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "相对于工作区根目录的路径，空串或 '.' 表示根目录",
                    },
                },
                "required": [],
            },
        },
    },
]

# 工具名 → 函数，方便调度
_TOOL_MAP: dict[str, callable] = {
    "run_code": run_code,
    "run_terminal": run_terminal,
    "read_file": read_file,
    "write_file": write_file,
    "list_files": list_files,
}


# ═══════════════════════════════════════════════════════════
# 工具系统提示（附加到对话 system message）
# ═══════════════════════════════════════════════════════════

TOOL_SYSTEM_PROMPT = """# 代码执行能力

你现在拥有在隔离沙箱中**真正执行代码**的能力。你可以：

1. **run_code** — 编写并运行 Python、JavaScript(Node)、Bash、C、C++、Java 代码
2. **run_terminal** — 执行终端命令（安装依赖、管理文件等）
3. **read_file** — 读取工作区文件内容
4. **write_file** — 将内容写入工作区文件
5. **list_files** — 查看工作区目录结构

## 使用原则

- **先读后改**：修改文件前，先用 read_file 查看当前内容
- **先写后跑**：需要执行代码时，先用 write_file 写入文件，再用 run_terminal 或 run_code 执行
- **查看结果**：代码执行后，分析 stdout/stderr 和退出码，向用户解释运行结果
- **在失败时修复**：如果代码编译失败或运行出错，根据错误信息修改代码并重试
- **控制输出量**：避免一次性输出大量数据；如果结果很长，做摘要或用 list_files 查看输出文件

## 重要安全注意

- 所有操作限制在当前用户的沙箱工作区中，无法访问他人文件
- 代码最长运行时间 30 秒，超时自动终止
- 工作区配额 500MB，写入前注意检查
- 文件路径必须使用相对路径（相对于工作区根）
"""

# 需要启用工具的 skill 名称列表（用户选用这些技能时自动激活 tools）
EXECUTABLE_SKILLS: set[str] = {
    "run-python", "run-js", "run-node", "run-bash", "run-sh",
    "run-c", "run-cpp", "run-java", "terminal", "coding",
    "code-runner", "code-executor", "sandbox",
}


# ═══════════════════════════════════════════════════════════
# 工具执行调度
# ═══════════════════════════════════════════════════════════

async def execute_tool(
    tool_name: str,
    tool_args: dict,
    user_id: int,
) -> str:
    """执行工具调用，返回 JSON 字符串结果（供 LLM 消费）。

    tool_name: 工具名称（run_code / run_terminal / ...）
    tool_args: 工具参数（由 LLM 生成的 JSON 对象）
    user_id: 当前用户 ID，用于隔离沙箱工作区
    """
    if tool_name not in _TOOL_MAP:
        return json.dumps({"error": f"未知工具: {tool_name}"}, ensure_ascii=False)

    fn = _TOOL_MAP[tool_name]
    try:
        if tool_name == "run_code":
            result = fn(
                code=tool_args.get("code", ""),
                language=tool_args.get("language", "python"),
                user_id=user_id,
                args=tool_args.get("args"),
            )
        elif tool_name == "run_terminal":
            result = fn(
                command=tool_args.get("command", ""),
                user_id=user_id,
                cwd_rel=tool_args.get("cwd", ""),
            )
        elif tool_name == "read_file":
            result = fn(
                path=tool_args.get("path", ""),
                user_id=user_id,
            )
        elif tool_name == "write_file":
            result = fn(
                path=tool_args.get("path", ""),
                content=tool_args.get("content", ""),
                user_id=user_id,
            )
        elif tool_name == "list_files":
            result = fn(
                path=tool_args.get("path", ""),
                user_id=user_id,
            )
        else:
            result = {"error": f"工具未实现: {tool_name}"}

        logger.info(f"Tool [{tool_name}] executed for user {user_id}: exit_code={result.get('exit_code', 'N/A')}")
        return json.dumps(result, ensure_ascii=False)

    except Exception as e:
        logger.exception(f"Tool [{tool_name}] failed for user {user_id}: {e}")
        return json.dumps({"error": f"工具执行异常: {e}"}, ensure_ascii=False)


def should_enable_tools(skills: list[str]) -> bool:
    """判断是否应为当前对话启用 agent 工具调用。

    当用户选用列表中任一 skill 匹配 EXECUTABLE_SKILLS 集时返回 True。
    """
    if not skills:
        return False
    requested = {s.lower().strip() for s in skills}
    return bool(requested & {s.lower() for s in EXECUTABLE_SKILLS})


def get_tool_summary(tool_name: str, tool_args: dict) -> str:
    """生成工具调用的人类可读摘要（用于前端展示）。"""
    if tool_name == "run_code":
        lang = tool_args.get("language", "python")
        code = tool_args.get("code", "")
        preview = code[:80].replace("\n", " ") + ("…" if len(code) > 80 else "")
        return f"执行 {lang} 代码: {preview}"
    elif tool_name == "run_terminal":
        cmd = tool_args.get("command", "")
        return f"执行命令: {cmd}"
    elif tool_name == "read_file":
        return f"读取文件: {tool_args.get('path', '')}"
    elif tool_name == "write_file":
        path = tool_args.get("path", "")
        content = tool_args.get("content", "")
        size = len(content)
        return f"写入文件: {path} ({size} 字符)"
    elif tool_name == "list_files":
        p = tool_args.get("path", "") or "."
        return f"列出目录: {p}"
    return f"调用 {tool_name}"
