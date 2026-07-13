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

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from .sandbox import run_code, run_terminal, read_file, write_file, list_files

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

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
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": (
                "为用户创建一个后台异步任务。当对话内容涉及需要较长时间执行、"
                "需要多步骤处理时调用此工具。任务创建后会出现在用户的侧边栏任务列表中。"
                "必须提供任务标题和描述；可选指定 Agent 名称、优先级(0-10)、标签。"
                "重要：auto_execute 参数控制是否立即执行——用户说'帮我做/生成/写...'等需求描述时设为 true；"
                "用户明确说'创建任务'或'新建任务'时设为 false。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "任务标题，简洁明了地描述任务目标",
                    },
                    "description": {
                        "type": "string",
                        "description": "任务详细描述，包含完整的执行指令和上下文",
                    },
                    "agent_name": {
                        "type": "string",
                        "description": "建议执行此任务的 Agent 名称（可选）",
                    },
                    "priority": {
                        "type": "integer",
                        "description": "任务优先级 0-10，默认 5",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "任务标签列表（可选）",
                    },
                    "auto_execute": {
                        "type": "boolean",
                        "description": (
                            "创建后是否立即自动执行任务。"
                            "true = 用户表达了要完成某事的需求（如'帮我做PPT'、'写个脚本'），创建后立即运行；"
                            "false = 用户明确说'创建任务'、'新建任务'，只创建不执行，由用户手动启动。"
                            "默认 true。"
                        ),
                    },
                },
                "required": ["title", "description"],
            },
        },
    },
]

# ── 技能执行工具（代码技能由框架真实沙箱执行，而非仅作提示词）──
RUN_SKILL_TOOL: dict = {
    "type": "function",
    "function": {
        "name": "run_skill",
        "description": (
            "执行一个已安装的「代码技能」。技能代码在隔离沙箱中真实运行"
            "（优先调用技能定义的 skill_main(ctx)，否则执行脚本本身并以 stdout 作为结果）。"
            "当某个已激活的代码技能能更直接地完成任务（如数据处理、格式转换、专属算法）时调用本工具，"
            "传入技能名称与参数。返回技能的结构化结果（skill_main 返回值）与 stdout。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "要执行的技能名称（须为已安装的代码技能）",
                },
                "args": {
                    "type": "object",
                    "description": "传给技能的参数对象，将作为 ctx['args'] 传入技能的 skill_main",
                },
            },
            "required": ["skill_name"],
        },
    },
}


# 工具名 → 函数，方便调度
_TOOL_MAP: dict[str, callable] = {
    "run_code": run_code,
    "run_terminal": run_terminal,
    "read_file": read_file,
    "write_file": write_file,
    "list_files": list_files,
    "create_task": "_create_task",  # 特殊标记，由 execute_tool 分发
    "run_skill": "_run_skill",      # 特殊标记，由 execute_tool 分发
}


# ═══════════════════════════════════════════════════════════
# 工作区快照工具（用于检测执行后新增文件）
# ═══════════════════════════════════════════════════════════

def _workspace_snapshot(user_id: int) -> set[str]:
    """返回工作区当前所有文件路径集合（同步）"""
    from .sandbox import list_files as _list
    r = _list(".", user_id)
    if not r.get("ok"):
        return set()
    return {e["path"] for e in r.get("entries", []) if e.get("type") == "file"}


_OUTPUT_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".pptx", ".docx", ".xlsx", ".pdf",
    ".csv", ".json", ".html", ".md", ".txt",
    ".mp3", ".wav", ".mp4", ".avi", ".zip",
}


def _workspace_new_files(user_id: int, pre: set[str]) -> list[dict]:
    """对比快照，返回新增的输出文件列表"""
    from .sandbox import _workspace_root
    import mimetypes
    root = _workspace_root(user_id)
    after = _workspace_snapshot(user_id)
    new_paths = after - pre
    results = []
    for rel_path in sorted(new_paths):
        from pathlib import Path
        p = root / rel_path
        try:
            ext = Path(rel_path).suffix.lower()
            if ext not in _OUTPUT_EXT:
                continue
            size = p.stat().st_size if p.exists() else 0
            mime, _ = mimetypes.guess_type(str(p))
            results.append({"path": rel_path, "name": Path(rel_path).name, "size": size, "mime": mime or ""})
        except Exception:
            pass
    return results


# ═══════════════════════════════════════════════════════════
# 工具系统提示（附加到对话 system message）
# ═══════════════════════════════════════════════════════════

TOOL_SYSTEM_PROMPT = """# 代码执行与文件工作区

你现在拥有在隔离沙箱中**真正执行代码**的能力。你可以：

1. **run_code** — 编写并运行 Python、JavaScript(Node)、Bash、C、C++、Java 代码
2. **run_terminal** — 执行终端命令（安装依赖、管理文件等）
3. **read_file** — 读取工作区文件内容
4. **write_file** — 将内容写入工作区文件
5. **list_files** — 查看工作区目录结构

## ⚠️ 文件保存规则（非常重要）

**所有生成/保存的文件必须使用相对路径，绝对不能使用 `/tmp`、`/root`、`/home` 等绝对路径。**

✅ 正确：
```python
img.save('logo.png')                    # 保存到工作区根目录
plt.savefig('output/chart.png')         # 保存到工作区的 output/ 子目录
with open('result.txt', 'w') as f: ...  # 保存到工作区根目录
```

❌ 错误：
```python
img.save('/tmp/logo.png')      # 用户看不到！
plt.savefig('/root/chart.png') # 用户看不到！
```

**原因**：代码在用户专属的远程工作区执行，使用相对路径时文件会出现在 IDE 页面（远程模式）中，用户可以直接预览和下载。使用绝对路径的文件用户无法访问。

## 使用原则

- **先读后改**：修改文件前，先用 read_file 查看当前内容
- **查看结果**：代码执行后，分析 stdout/stderr 和退出码，告知用户运行结果
- **报告新文件**：代码执行结果中若包含 `new_files`，务必告诉用户文件已生成，可以在「IDE → 远程」查看
- **在失败时修复**：如果代码出错，根据错误信息修改后重试（最多 3 次）
- **控制输出量**：避免一次性打印大量数据；结果太长时做摘要

## 重要安全注意

- 所有操作限制在当前用户的沙箱工作区中，无法访问他人文件
- 代码最长运行时间 30 秒，超时自动终止
- 工作区配额 500MB，写入前注意检查

## 主动创建任务（重要）

**当用户让你完成 PPT、报告、数据分析、模型训练等复杂耗时工作时，必须主动调用 `create_task` 工具创建后台任务，而不是仅用文字描述步骤。**

- 遇到「生成 PPT」「写报告」「做分析」「训练/微调模型」等指令 → 立刻 `create_task`，且 `auto_execute=true` 自动执行
- 用户明确说「创建一个XX任务」「新建任务」→ `create_task` 且 `auto_execute=false`，只创建不执行
- 任务 description 要包含完整执行指令，让 Agent 拿到后能直接开始
- 创建任务后告知用户任务已提交，可在侧边栏「任务」页面追踪进度
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
    session: "AsyncSession | None" = None,
) -> str:
    """执行工具调用，返回 JSON 字符串结果（供 LLM 消费）。"""
    if tool_name not in _TOOL_MAP:
        return json.dumps({"error": f"未知工具: {tool_name}"}, ensure_ascii=False)

    try:
        # ── create_task 特殊处理（需要数据库会话）──
        if tool_name == "create_task":
            return await _execute_create_task(tool_args, user_id, session)

        # ── run_skill 特殊处理（代码技能真沙箱执行）──
        if tool_name == "run_skill":
            from .skill_runtime import execute_skill
            return json.dumps(
                await execute_skill(
                    user_id=user_id,
                    skill_name=tool_args.get("skill_name", ""),
                    args=tool_args.get("args"),
                    session=session,
                ),
                ensure_ascii=False,
            )

        # ── 桌面客户端本地代理：优先转发给本地执行 ──
        _LOCAL_TOOLS = {"run_code", "run_terminal", "read_file", "write_file", "list_files"}
        if tool_name in _LOCAL_TOOLS:
            from .local_proxy import is_connected, call_local_tool
            if is_connected(user_id):
                try:
                    result = await call_local_tool(user_id, tool_name, tool_args)
                    logger.info(f"Tool [{tool_name}] executed locally for user {user_id}")
                    return json.dumps(result, ensure_ascii=False)
                except Exception as e:
                    logger.warning(f"Local tool fallback to server ({e})")
                    # 本地执行失败则 fall-through 到服务端执行

        fn = _TOOL_MAP[tool_name]

        # run_code / run_terminal 执行前先快照工作区，用于检测新增文件
        pre_snapshot: set[str] = set()
        is_exec = tool_name in ("run_code", "run_terminal")
        if is_exec:
            pre_snapshot = _workspace_snapshot(user_id)

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
            result = fn(path=tool_args.get("path") or tool_args.get("file_path") or "", user_id=user_id)
        elif tool_name == "write_file":
            result = fn(
                path=tool_args.get("path") or tool_args.get("file_path") or "",
                content=tool_args.get("content", ""),
                user_id=user_id,
            )
        elif tool_name == "list_files":
            result = fn(path=tool_args.get("path") or tool_args.get("file_path") or "", user_id=user_id)
        else:
            result = {"error": f"工具未实现: {tool_name}"}

        # 执行后扫描新文件，附加到结果供 AI 告知用户
        if is_exec:
            new_files = _workspace_new_files(user_id, pre_snapshot)
            if new_files:
                result["new_files"] = new_files
                result["new_files_tip"] = f"已在远程工作区生成 {len(new_files)} 个文件，可在 IDE 页面（远程模式）查看或下载。"

        logger.info(f"Tool [{tool_name}] executed for user {user_id}: exit_code={result.get('exit_code', 'N/A')}")
        return json.dumps(result, ensure_ascii=False)

    except Exception as e:
        logger.exception(f"Tool [{tool_name}] failed for user {user_id}: {e}")
        return json.dumps({"error": f"工具执行异常: {e}"}, ensure_ascii=False)


async def _execute_create_task(
    args: dict,
    user_id: int,
    session: "AsyncSession | None",
) -> str:
    """在数据库中创建任务（由 LLM 通过 create_task 工具调用触发），并自动开始执行。

    注意：create_task 始终使用**独立**数据库会话，不复用调用方 session：
      1. 编排任务路径（auto/多 Agent 等）未逐层透传 session，此前会误报
         「创建任务需要数据库会话」——独立会话彻底规避（议题 #1.2）；
      2. 新任务是一个独立后台执行单元，必须在启动后台执行前 commit，
         否则后台任务用新会话读不到未提交的行。
    """
    from ...models.task import Task
    from ..database import create_session

    title = (args.get("title") or "").strip()
    description = (args.get("description") or "").strip()
    if not title:
        return json.dumps({"error": "任务标题不能为空"}, ensure_ascii=False)

    auto_execute = bool(args.get("auto_execute", True))
    mode = args.get("mode", "auto")
    priority = max(0, min(10, int(args.get("priority", 5) or 5)))

    task_id = uuid.uuid4().hex[:12]
    async with create_session() as own:
        task = Task(
            id=task_id,
            user_id=user_id,
            title=title,
            description=description,
            status="running" if auto_execute else "pending",
            priority=priority,
            mode=mode,
            think_depth=1,
            think_visibility="visible",
            assigned_agent=args.get("agent_name", ""),
            tags=args.get("tags") or [],
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        own.add(task)
        await own.commit()

    logger.info(f"create_task 工具创建任务: id={task_id} title={title!r} user={user_id} auto_execute={auto_execute}")

    # 自动执行任务（后台运行）—— 已 commit，后台会话可读到该行
    if auto_execute:
        try:
            queue: asyncio.Queue = asyncio.Queue()
            asyncio.create_task(
                _bg_execute_task(task_id, user_id, queue, mode)
            )
            return json.dumps({
                "ok": True,
                "task_id": task_id,
                "title": title,
                "status": "running",
                "message": f"任务「{title}」已创建并开始执行，可在侧边栏任务列表中查看进度。",
            }, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"自动启动任务失败: {e}")
            # 回退为 pending（用独立会话改状态）
            try:
                async with create_session() as own2:
                    t = await own2.get(Task, task_id)
                    if t:
                        t.status = "pending"
                        await own2.commit()
            except Exception:
                pass
            return json.dumps({
                "ok": True,
                "task_id": task_id,
                "title": title,
                "status": "pending",
                "message": f"任务「{title}」已创建，可在侧边栏任务列表中手动执行。",
            }, ensure_ascii=False)

    return json.dumps({
        "ok": True,
        "task_id": task_id,
        "title": title,
        "status": "pending",
        "message": f"任务「{title}」已创建，可在侧边栏任务列表中查看和执行。",
    }, ensure_ascii=False)


async def _bg_execute_task(task_id: str, user_id: int, queue: asyncio.Queue, mode: str = "auto"):
    """后台执行任务的包装函数"""
    try:
        from .orchestrator import execute_task
        await execute_task(
            task_id=task_id,
            event_queue=queue,
            user_id=user_id,
            assignment="ai" if mode == "auto" else "direct",
        )
    except Exception as e:
        logger.error(f"后台任务执行异常: {e}", exc_info=True)


def should_enable_tools(skills: list[str]) -> bool:
    """判断是否应为当前对话启用 agent 工具调用。

    始终返回 True —— 内部工具（call_internal_api、request_user_input）
    对所有对话都可用；代码执行工具仅在选用 EXECUTABLE_SKILLS 时附加。
    """
    return True


def should_enable_code_tools(skills: list[str]) -> bool:
    """（同步、名称级）判断是否需要代码执行类工具。

    向后兼容：仅在技能名命中 EXECUTABLE_SKILLS 时返回 True。
    更健壮、按技能实际配置判定的版本见 resolve_code_tools_enabled。
    """
    if not skills:
        return False
    requested = {s.lower().strip() for s in skills}
    return bool(requested & {s.lower() for s in EXECUTABLE_SKILLS})


async def resolve_code_tools_enabled(skill_names: list[str], user_id: int) -> bool:
    """（异步、配置级）健壮判断：代码/技能工具是否解锁。

    解锁条件（满足任一）：
      1) 技能名命中 EXECUTABLE_SKILLS（向后兼容）
      2) 该技能是「代码技能」——config.code 非空（不再依赖技能名拼写）
      3) 该技能 config.capabilities 含 "code"
    这样即便 GitHub 市场装回的技能名与预设不一致，只要它是代码技能就会被正确解锁。
    """
    if not skill_names:
        return False
    requested = {s.lower().strip() for s in skill_names}
    if requested & {s.lower() for s in EXECUTABLE_SKILLS}:
        return True
    try:
        from ..database import create_session
        from ..models.skill import Skill as SkillModel
        from sqlalchemy import select
        async with create_session() as session:
            rows = (await session.execute(
                select(SkillModel).where(
                    SkillModel.name.in_(skill_names),
                    SkillModel.is_installed == True,  # noqa: E712
                )
            )).scalars().all()
        for sk in rows:
            cfg = sk.config or {}
            if cfg.get("code"):
                return True
            caps = cfg.get("capabilities") or []
            if isinstance(caps, list) and "code" in [str(c).lower() for c in caps]:
                return True
    except Exception as e:
        logger.warning(f"resolve_code_tools_enabled 失败，回退名称匹配: {e}")
    return False


# 代码执行类工具名（受 Agent skills 约束，须与 EXECUTABLE_SKILLS 语义对应）
CODE_TOOL_NAMES: set[str] = {
    "run_code", "run_terminal", "read_file", "write_file", "list_files",
}


def get_enabled_tools(enable_code: bool = False) -> list[dict]:
    """按是否已解锁代码权限返回工具定义。

    - enable_code=True：返回全部代码执行工具（run_code/run_terminal/read_file/
      write_file/list_files/create_task）+ run_skill 技能执行工具；
    - enable_code=False：返回空列表（调用方另行追加内部工具 call_internal_api 等）。
    """
    if not enable_code:
        return []
    return [dict(t) for t in TOOL_DEFINITIONS] + [RUN_SKILL_TOOL]


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
    elif tool_name == "call_internal_api":
        reason = tool_args.get("reason", "")
        # 不暴露内部 API 路径，只显示调用目的
        if reason:
            return f"查询平台信息: {reason}"
        return "查询平台信息"
    elif tool_name == "request_user_input":
        itype = tool_args.get("interaction_type", "")
        title = tool_args.get("title", "")
        type_names = {
            "confirm": "确认",
            "select": "选择",
            "multi_select": "多选",
            "form": "表单填写",
        }
        type_label = type_names.get(itype, "交互")
        if title:
            return f"{type_label}: {title}"
        return f"请求用户{type_label}"
    elif tool_name == "run_skill":
        name = tool_args.get("skill_name", "")
        return f"执行技能: {name}" if name else "执行技能"
    return f"调用 {tool_name}"
