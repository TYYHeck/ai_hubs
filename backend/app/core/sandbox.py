# -*- coding: utf-8 -*-
"""
沙箱执行层 — 代码 / 终端命令 / 文件操作

复用 ide.py 的运行引擎（解释器 + 编译器），供 Agent 工具调用链与 IDE API 共同使用。
所有执行均在用户隔离工作区 {DATA_DIR}/ide_workspace/{user_id}/ 内完成，
带超时、路径越界防护与配额检查。
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ..config import DATA_DIR

logger = logging.getLogger("ai_hubs.sandbox")

_RUN_TIMEOUT = 30  # 秒
_USER_QUOTA_BYTES = 500 * 1024 * 1024  # 500MB

# ── 解释器表（脚本型语言）──
_INTERPRETERS: dict[str, list[str]] = {
    ".py": ["python3", "python"],
    ".js": ["node"],
    ".mjs": ["node"],
    ".sh": ["bash"],
    ".pl": ["perl"],
}

# ── 编译型语言 ──
_COMPILE_LANGS: dict[str, dict] = {
    ".c": {
        "compilers": ["gcc"],
        "build": lambda src, out: ["gcc", src, "-o", out, "-lm"],
        "run": lambda out, args: [out] + list(args),
    },
    ".cpp": {
        "compilers": ["g++"],
        "build": lambda src, out: ["g++", src, "-o", out, "-std=c++17"],
        "run": lambda out, args: [out] + list(args),
    },
    ".cc": {
        "compilers": ["g++"],
        "build": lambda src, out: ["g++", src, "-o", out, "-std=c++17"],
        "run": lambda out, args: [out] + list(args),
    },
    ".cxx": {
        "compilers": ["g++"],
        "build": lambda src, out: ["g++", src, "-o", out, "-std=c++17"],
        "run": lambda out, args: [out] + list(args),
    },
    ".java": {
        "compilers": ["javac"],
        "build": lambda src, out: ["javac", "-d", str(Path(out).parent), src],
        "run": lambda out, args: ["java", "-cp", str(Path(out).parent), Path(out).stem] + list(args),
    },
}

# ── 语言名 → 扩展名 ──
_LANG_TO_EXT: dict[str, str] = {
    "python": ".py",
    "py": ".py",
    "javascript": ".js",
    "js": ".js",
    "node": ".js",
    "bash": ".sh",
    "sh": ".sh",
    "shell": ".sh",
    "c": ".c",
    "cpp": ".cpp",
    "c++": ".cpp",
    "cxx": ".cpp",
    "java": ".java",
    "perl": ".pl",
}


def _find_exe(candidates: list[str]) -> str | None:
    """在 PATH 中查找第一个可用解释器/编译器"""
    for c in candidates:
        if shutil.which(c):
            return c
    return None


def _workspace_root(user_id: int) -> Path:
    """用户沙箱工作区根目录（自动创建）"""
    root = DATA_DIR / "ide_workspace" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _resolve(root: Path, rel: str) -> Path:
    """安全解析相对/绝对路径，杜绝目录穿越"""
    if not rel:
        rel = "."
    p = Path(rel)
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (root / rel).resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise PermissionError(f"非法路径（越界）: {rel}")
    return resolved


def _dir_size(root: Path) -> int:
    """递归统计工作区已用字节数"""
    total = 0
    try:
        for entry in root.rglob("*"):
            if entry.is_file():
                try:
                    total += entry.stat().st_size
                except OSError:
                    continue
    except OSError:
        pass
    return total


def _enforce_quota(root: Path, extra_bytes: int = 0) -> None:
    """校验写入后是否超出用户配额"""
    used = _dir_size(root)
    if used + extra_bytes > _USER_QUOTA_BYTES:
        free = max(0, _USER_QUOTA_BYTES - used)
        raise PermissionError(
            f"工作区空间不足：配额 {_USER_QUOTA_BYTES // (1024 * 1024)}MB，"
            f"已用约 {used // (1024 * 1024)}MB，剩余约 {free // (1024 * 1024)}MB"
        )


def _resolve_safe(root: Path, rel: str) -> Path:
    """安全解析路径（与 _resolve 等价，供 IDE API 复用，越界抛 PermissionError）。"""
    return _resolve(root, rel)


def _enforce_quota_http(root: Path, extra_bytes: int = 0) -> None:
    """配额校验的 HTTP 版本：超限时抛出 413 HTTPException 而非 PermissionError。"""
    from fastapi import HTTPException, status as http_status

    try:
        _enforce_quota(root, extra_bytes)
    except PermissionError as e:
        raise HTTPException(
            status_code=http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=str(e),
        ) from e


def _run_cmd(cmd: list[str], cwd: str, timeout: int = _RUN_TIMEOUT) -> subprocess.CompletedProcess:
    """执行命令并捕获输出"""
    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


# ═══════════════════════════════════════════════════════════
# 公共 API
# ═══════════════════════════════════════════════════════════

def run_code(
    code: str,
    language: str,
    user_id: int,
    args: list[str] | None = None,
    filename: str | None = None,
    timeout: int = _RUN_TIMEOUT,
) -> dict:
    """在用户沙箱中写入代码并执行。

    返回: {"stdout": str, "stderr": str, "exit_code": int, "timed_out": bool, "command": str}
    """
    args = list(args or [])
    root = _workspace_root(user_id)
    ext = _LANG_TO_EXT.get(language.lower(), ".py")
    if ext not in _INTERPRETERS and ext not in _COMPILE_LANGS:
        supported = sorted(set(list(_INTERPRETERS.keys()) + list(_COMPILE_LANGS.keys())))
        return {
            "stdout": "",
            "stderr": f"不支持的语言类型: {language}。支持的类型: python, javascript, bash, c, cpp, java, perl",
            "exit_code": -1,
            "timed_out": False,
            "command": "",
        }

    # 生成文件名
    if filename:
        safe_name = Path(filename).name
    else:
        safe_name = f"_agent_{os.urandom(4).hex()}{ext}"

    target = root / safe_name
    # 配额检查
    encoded = code.encode("utf-8", errors="replace")
    _enforce_quota(root, len(encoded))
    target.write_text(code, encoding="utf-8")

    is_temp = not filename  # 未指定文件名 → AI 临时文件，执行后删除
    try:
        return _execute_file(str(target), user_id, args, timeout)
    finally:
        if is_temp:
            try:
                target.unlink(missing_ok=True)
            except Exception:
                pass


def _execute_file(filepath: str, user_id: int, args: list[str], timeout: int = _RUN_TIMEOUT) -> dict:
    """执行工作区内的文件（已写入的）"""
    root = _workspace_root(user_id)
    target = _resolve(root, filepath)
    if not target.exists() or not target.is_file():
        return {
            "stdout": "", "stderr": f"文件不存在: {filepath}",
            "exit_code": -1, "timed_out": False, "command": "",
        }

    ext = target.suffix.lower()
    workdir = str(target.parent)
    logs: list[str] = []

    # ── 编译型语言 ──
    if ext in _COMPILE_LANGS:
        spec = _COMPILE_LANGS[ext]
        compiler = _find_exe(spec["compilers"])
        if compiler is None:
            return {
                "stdout": "", "stderr": f"未找到编译器: {' / '.join(spec['compilers'])}",
                "exit_code": -1, "timed_out": False, "command": "",
            }
        out_path = str(target.with_suffix(""))
        build_cmd = spec["build"](str(target), out_path)
        logs.append("[编译] " + " ".join(build_cmd))
        try:
            build = _run_cmd(build_cmd, workdir, timeout)
        except subprocess.TimeoutExpired:
            return {
                "stdout": "", "stderr": f"编译超时（>{timeout}s）",
                "exit_code": -1, "timed_out": True, "command": " ".join(build_cmd),
            }
        if build.returncode != 0:
            return {
                "stdout": build.stdout or "",
                "stderr": build.stderr or "编译失败",
                "exit_code": build.returncode,
                "timed_out": False,
                "command": " ".join(build_cmd),
            }
        run_cmd = spec["run"](out_path, args)
        logs.append("[运行] " + " ".join(run_cmd))
        try:
            proc = _run_cmd(run_cmd, workdir, timeout)
            return {
                "stdout": proc.stdout or "",
                "stderr": proc.stderr or "",
                "exit_code": proc.returncode,
                "timed_out": False,
                "command": " && ".join(logs),
            }
        except subprocess.TimeoutExpired as e:
            return {
                "stdout": e.stdout or "",
                "stderr": f"执行超时（>{timeout}s），已被终止。\n{e.stderr or ''}",
                "exit_code": -1, "timed_out": True,
                "command": " && ".join(logs),
            }

    # ── 脚本型语言 ──
    if ext not in _INTERPRETERS:
        supported = sorted(set(list(_INTERPRETERS.keys()) + list(_COMPILE_LANGS.keys())))
        return {
            "stdout": "", "stderr": f"不支持的文件类型 {ext}，仅支持: " + ", ".join(supported),
            "exit_code": -1, "timed_out": False, "command": "",
        }

    exe = _find_exe(_INTERPRETERS[ext])
    if exe is None:
        return {
            "stdout": "", "stderr": f"未找到解释器: {' / '.join(_INTERPRETERS[ext])}",
            "exit_code": -1, "timed_out": False, "command": "",
        }

    cmd = [exe, str(target)] + args
    try:
        proc = _run_cmd(cmd, workdir, timeout)
        return {
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "exit_code": proc.returncode,
            "timed_out": False,
            "command": " ".join(cmd),
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": e.stdout or "",
            "stderr": f"执行超时（>{timeout}s），已被终止。\n{e.stderr or ''}",
            "exit_code": -1, "timed_out": True,
            "command": " ".join(cmd),
        }


def run_terminal(command: str, user_id: int, cwd_rel: str = "", timeout: int = _RUN_TIMEOUT) -> dict:
    """在用户沙箱工作区中执行终端命令。

    command: bash -c 执行的命令字符串
    cwd_rel: 相对于工作区根目录的子目录，空表示工作区根
    """
    root = _workspace_root(user_id)
    workdir = str(_resolve(root, cwd_rel) if cwd_rel else root)

    cmd = ["bash", "-c", command]
    try:
        proc = _run_cmd(cmd, workdir, timeout)
        return {
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "exit_code": proc.returncode,
            "timed_out": False,
            "command": command,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": e.stdout or "",
            "stderr": f"命令超时（>{timeout}s），已被终止。\n{e.stderr or ''}",
            "exit_code": -1, "timed_out": True,
            "command": command,
        }


def read_file(path: str, user_id: int) -> dict:
    """读取工作区内的文件内容"""
    root = _workspace_root(user_id)
    target = _resolve(root, path)
    if not target.exists():
        return {"ok": False, "error": f"文件不存在: {path}"}
    if target.is_dir():
        return {"ok": False, "error": f"目标是目录: {path}"}
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return {"ok": False, "error": f"读取失败: {e}"}
    return {
        "ok": True,
        "path": path,
        "name": target.name,
        "content": content,
        "size": target.stat().st_size,
    }


def write_file(path: str, content: str, user_id: int) -> dict:
    """写入文件到工作区（自动创建父目录，受配额限制）"""
    if not path or not str(path).strip():
        return {"ok": False, "error": "路径不能为空，请传入文件相对路径（如 'result.md'）"}
    root = _workspace_root(user_id)
    target = _resolve(root, path)
    if target.is_dir():
        return {"ok": False, "error": f"路径是目录: {path}"}

    try:
        existing = target.stat().st_size if target.exists() else 0
    except OSError:
        existing = 0
    new_bytes = len(content.encode("utf-8", errors="replace"))
    try:
        _enforce_quota(root, max(0, new_bytes - existing))
    except PermissionError as e:
        return {"ok": False, "error": str(e)}

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_text(content, encoding="utf-8")
    except Exception as e:
        return {"ok": False, "error": f"写入失败: {e}"}
    return {"ok": True, "path": path, "name": target.name, "size": target.stat().st_size}


def list_files(path: str, user_id: int) -> dict:
    """列出工作区目录内容"""
    root = _workspace_root(user_id)
    target = _resolve(root, path if path else ".")

    if not target.exists():
        return {"ok": False, "error": f"路径不存在: {path}"}
    if target.is_file():
        return {"ok": True, "path": str(target.relative_to(root)).replace("\\", "/"), "entries": []}

    entries = []
    try:
        for child in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
            if child.name.startswith(".") and child.is_dir():
                continue
            rel = str(child.relative_to(root)).replace("\\", "/")
            try:
                size = child.stat().st_size
            except OSError:
                size = 0
            entries.append({
                "name": child.name,
                "path": rel,
                "type": "dir" if child.is_dir() else "file",
                "size": size,
            })
    except OSError as e:
        return {"ok": False, "error": f"列表失败: {e}"}

    return {"ok": True, "path": str(target.relative_to(root)).replace("\\", "/") or ".", "entries": entries}
