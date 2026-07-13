# -*- coding: utf-8 -*-
"""
技能运行时 — 把「代码技能」从「贴给 LLM 的提示词」升级为「框架真实沙箱执行」。

契约（Python 一等公民）：
  技能 config.code 是一段 Python 源码。框架将其落盘到用户工作区 skills/ 下，
  并用 runner 加载该模块：
    - 若模块定义了 `skill_main(ctx: dict) -> Any`，框架调用它，返回值作为结构化结果；
    - 否则仅执行模块顶层代码，stdout 作为结果。
  ctx 包含： {"skill_name", "args"(工具调用参数), "user_id", "workspace"}。

非 Python 技能（language != python）：直接按该语言执行源码，args 透传为 argv，
stdout 作为结果（ctx 不注入，遵循最小可用原则）。

执行复用 sandbox 层：路径隔离 + 30s 超时 + 配额限制，与 run_code 同一安全边界。
结果以 JSON 文件回传，避免与技能自身 stdout 混淆。
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select

from .sandbox import _workspace_root, run_code

logger = logging.getLogger("ai_hubs.skill_runtime")

# runner 模板：加载技能模块、调用 skill_main、将结果写入 RESULT_PATH
_PY_RUNNER = '''\
import json, sys, traceback, asyncio, importlib.util, pathlib

CTX_PATH = r"{ctx_path}"
SKILL_PATH = r"{skill_path}"
RESULT_PATH = r"{result_path}"

def _err(m):
    print(m, file=sys.stderr)

try:
    ctx = json.load(open(CTX_PATH, "r", encoding="utf-8"))
except Exception as e:
    _err("SKILL_CTX_ERROR: " + repr(e)); sys.exit(2)

parent = str(pathlib.Path(SKILL_PATH).parent)
sys.path.insert(0, parent)
spec = importlib.util.spec_from_file_location("__aihubs_skill_mod", SKILL_PATH)
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except Exception as e:
    _err("SKILL_IMPORT_ERROR: " + repr(e)); traceback.print_exc(); sys.exit(2)

result = None
fn = getattr(mod, "skill_main", None)
if callable(fn):
    try:
        r = fn(ctx)
        if hasattr(asyncio, "iscoroutine") and asyncio.iscoroutine(r):
            r = asyncio.run(r)
        result = r
    except Exception as e:
        _err("SKILL_RUN_ERROR: " + repr(e)); traceback.print_exc(); sys.exit(3)

try:
    with open(RESULT_PATH, "w", encoding="utf-8") as f:
        json.dump({{"result": result}}, f, ensure_ascii=False, default=str)
except Exception as e:
    _err("SKILL_RESULT_WRITE_ERROR: " + repr(e)); sys.exit(4)
'''


def _args_to_argv(args: Any) -> list[str]:
    """将工具参数转换为 argv 列表（供非 Python 技能透传）。"""
    if args is None:
        return []
    if isinstance(args, list):
        return [str(a) for a in args]
    if isinstance(args, dict):
        out: list[str] = []
        for k, v in args.items():
            out.append(f"--{k}")
            if v not in (None, True):
                out.append(str(v))
        return out
    return [str(args)]


def _safe_name(skill_name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_]", "_", skill_name)
    return s[:60] or "skill"


async def execute_skill(
    user_id: int,
    skill_name: str,
    args: Any = None,
    session=None,
) -> dict:
    """真实执行一个代码技能，返回结构化结果。

    返回: {"ok", "skill", "language", "stdout", "stderr", "exit_code",
           "timed_out", "result"(skill_main 返回值或 None)}
    """
    # 1. 载入技能（仅在会话内查询，立即关闭）
    from ..database import create_session
    from ..models.skill import Skill as SkillModel

    code: Optional[str] = None
    lang = "python"
    async with create_session() as s:
        row = (
            await s.execute(
                select(SkillModel).where(
                    SkillModel.name == skill_name,
                    SkillModel.is_installed == True,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return {"ok": False, "error": f"技能不存在或未安装: {skill_name}"}
        cfg = row.config or {}
        code = cfg.get("code")
        if not code:
            return {"ok": False, "error": f"技能「{skill_name}」不含可执行代码（非代码技能）"}
        lang = (cfg.get("language") or "python").lower()

    root = _workspace_root(user_id)
    skills_dir = root / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    safe = _safe_name(skill_name)

    skill_path = skills_dir / f"{safe}.py"
    skill_path.write_text(code, encoding="utf-8")

    ctx = {
        "skill_name": skill_name,
        "args": args or {},
        "user_id": user_id,
        "workspace": str(root),
    }
    ctx_path = skills_dir / f"{safe}.ctx.json"
    ctx_path.write_text(json.dumps(ctx, ensure_ascii=False), encoding="utf-8")
    result_path = skills_dir / f"{safe}.result.json"
    if result_path.exists():
        result_path.unlink()

    # 2. 执行
    if lang in ("python", "py"):
        runner = _PY_RUNNER.format(
            ctx_path=str(ctx_path),
            skill_path=str(skill_path),
            result_path=str(result_path),
        )
        run = run_code(code=runner, language="python", user_id=user_id)
    else:
        run = run_code(
            code=code,
            language=lang,
            user_id=user_id,
            args=_args_to_argv(args),
        )

    # 3. 读取结构化结果
    result_data: Any = None
    if result_path.exists():
        try:
            result_data = json.loads(result_path.read_text(encoding="utf-8")).get("result")
        except Exception as e:
            logger.warning(f"技能 {skill_name} 结果解析失败: {e}")
            result_data = None

    return {
        "ok": True,
        "skill": skill_name,
        "language": lang,
        "stdout": run.get("stdout", ""),
        "stderr": run.get("stderr", ""),
        "exit_code": run.get("exit_code"),
        "timed_out": run.get("timed_out", False),
        "result": result_data,
    }
