# -*- coding: utf-8 -*-
"""
技能市场服务 — GitHub 检索与安装（零外部依赖，使用标准库）

能力：
  - search_github(q, page): 调用 GitHub Search API 检索仓库。
  - fetch_github_file(full_name, branch, path): 从 raw.githubusercontent.com 拉取文件内容。
  - detect_entry(full_name, branch): 自动探测技能入口文件（skill.py/main.py/index.js/README.md）。
  - install_github_skill(...): 拉取技能代码并组装为 Skill 行数据（落库由 API 层完成）。

网络不可用时：所有方法返回可降级的结果（空列表 / 异常抛出由调用方捕获），
保证「技能市场」页面在离线环境也能正常展示与创建本地技能。
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

logger = logging.getLogger("ai_hubs.skill_service")

_GITHUB_API = "https://api.github.com"
_GITHUB_RAW = "https://raw.githubusercontent.com"
_HTTP_TIMEOUT = 8  # 秒

# 自动探测的入口文件优先级
_CANDIDATE_ENTRIES = [
    "skill.py", "main.py", "agent.py", "index.js", "index.ts",
    "skill.js", "skill.json", "README.md", "readme.md",
]


def _http_get_json(url: str, timeout: int = _HTTP_TIMEOUT) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "AI-Hubs-Skill-Market",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_get_text(url: str, timeout: int = _HTTP_TIMEOUT) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "AI-Hubs-Skill-Market"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


async def search_github(q: str, page: int = 1, per_page: int = 20) -> dict:
    """
    检索 GitHub 仓库（按 stars 排序）。
    返回 {items:[GithubSkill-like], total, error}。出错时 error 非空、items 为空。
    """
    try:
        query = f"{q} in:name,description,readme sort:stars"
        params = urllib.parse.urlencode({"q": query, "page": page, "per_page": per_page})
        url = f"{_GITHUB_API}/search/repositories?{params}"
        data = _http_get_json(url)
        items = []
        for r in data.get("items", []):
            items.append({
                "full_name": r.get("full_name", ""),
                "name": r.get("name", ""),
                "description": r.get("description") or "",
                "html_url": r.get("html_url", ""),
                "stars": r.get("stargazers_count", 0),
                "language": r.get("language"),
                "default_branch": r.get("default_branch", "main"),
            })
        return {"items": items, "total": data.get("total_count", 0), "error": None}
    except urllib.error.URLError as e:
        msg = f"无法连接 GitHub（网络受限）: {e.reason if hasattr(e, 'reason') else e}"
        logger.warning(msg)
        return {"items": [], "total": 0, "error": msg}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"GitHub 检索失败: {type(e).__name__}: {e}")
        return {"items": [], "total": 0, "error": f"检索失败: {e}"}


async def detect_entry(full_name: str, branch: str) -> Optional[str]:
    """探测仓库中是否存在约定入口文件，返回相对路径或 None。"""
    for cand in _CANDIDATE_ENTRIES:
        url = f"{_GITHUB_RAW}/{full_name}/{branch}/{cand}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AI-Hubs-Skill-Market"})
            with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
                if resp.status == 200:
                    return cand
        except Exception:  # noqa: BLE001
            continue
    return None


async def fetch_github_file(full_name: str, branch: str, path: str) -> str:
    """从 raw 拉取指定文件内容；不存在抛 FileNotFoundError。"""
    url = f"{_GITHUB_RAW}/{full_name}/{branch}/{path.lstrip('/')}"
    try:
        return _http_get_text(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise FileNotFoundError(f"仓库中未找到文件: {path}") from e
        raise


async def install_github_skill(
    full_name: str,
    html_url: str = "",
    description: str = "",
    branch: str = "",
    path: str = "",
    category: str = "github",
) -> dict:
    """
    组装一个可落库的技能数据（不写库，由 API 层负责）。
    返回 {name, description, category, source, github_url, version, entry, code}。
    """
    # 取默认分支
    if not branch:
        try:
            repo = _http_get_json(f"{_GITHUB_API}/repos/{full_name}")
            branch = repo.get("default_branch", "main")
        except Exception:  # noqa: BLE001
            branch = "main"

    # 探测/指定入口
    entry = path.strip()
    if not entry:
        entry = await detect_entry(full_name, branch) or "README.md"

    try:
        code = await fetch_github_file(full_name, branch, entry)
    except FileNotFoundError:
        code = f"# 来自 {full_name}\n# 未找到可下载的入口文件（{entry}），请手动补充技能实现。\n"

    repo_name = full_name.split("/")[-1]
    if not description:
        try:
            repo = _http_get_json(f"{_GITHUB_API}/repos/{full_name}")
            description = repo.get("description") or f"GitHub 技能: {full_name}"
        except Exception:  # noqa: BLE001
            description = f"GitHub 技能: {full_name}"

    return {
        "name": repo_name,
        "description": description,
        "category": category,
        "source": "github",
        "github_url": html_url or f"https://github.com/{full_name}",
        "version": "1.0.0",
        "entry": entry,
        "code": code,
        "config": {"full_name": full_name, "branch": branch},
    }
