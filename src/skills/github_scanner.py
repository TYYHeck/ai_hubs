# -*- coding: utf-8 -*-
"""
GitHub 技能扫描器 —— 搜索 GitHub 上可用的 AI 技能/提示词

搜索策略:
  1. GitHub Topics: ai-skill, prompt-template, llm-tool
  2. 仓库 README 解析
  3. 按相关度排序
"""

from __future__ import annotations
import json
import logging
import urllib.request
import urllib.error
from typing import Optional

logger = logging.getLogger("ai_hubs.github_scan")

GITHUB_API = "https://api.github.com"
SEARCH_TOPICS = [
    "ai-skill",
    "prompt-engineering",
    "llm-tool",
    "agent-skill",
    "ai-agent-tool",
]

SKILL_PATTERNS: dict[str, str] = {
    "coding": "code assistant OR programming OR developer tool",
    "research": "research OR analysis OR investigation",
    "writing": "writing OR content OR documentation",
    "data": "data analysis OR visualization OR sql",
    "devops": "docker OR kubernetes OR deployment OR cicd",
    "design": "UI design OR CSS OR frontend OR styling",
}


def search_github_skills(
    query: str = "",
    category: str = "",
    page: int = 1,
    per_page: int = 10,
) -> list[dict]:
    """搜索 GitHub 上的 AI 技能

    Args:
        query: 搜索关键词
        category: 技能分类
        page: 页码
        per_page: 每页数量

    Returns:
        技能列表 (dict 格式)
    """
    results: list[dict] = []

    # 构建搜索查询
    search_parts = []
    if query:
        search_parts.append(query)
    else:
        search_parts.append("prompt OR skill OR agent OR tool")
    search_parts.append("language:markdown")

    if category and category in SKILL_PATTERNS:
        search_parts.append(SKILL_PATTERNS[category])

    search_query = " ".join(search_parts)

    try:
        url = (
            f"{GITHUB_API}/search/repositories"
            f"?q={urllib.request.quote(search_query)}"
            f"&sort=stars&order=desc"
            f"&per_page={per_page}"
            f"&page={page}"
        )
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/vnd.github.v3+json")
        req.add_header("User-Agent", "AI-Hubs-Skill-Scanner")

        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())

        for repo in data.get("items", []):
            skill = _parse_repo(repo, category)
            if skill:
                results.append(skill)

        logger.info(f"GitHub 搜索: 找到 {data.get('total_count', 0)} 个仓库，"
                     f"解析 {len(results)} 个技能")

    except urllib.error.HTTPError as e:
        if e.code == 403:
            logger.warning("GitHub API 限流，使用兜底数据")
            return _get_fallback_skills(query, category)
        logger.error(f"GitHub API 错误: {e}")
        return _get_fallback_skills(query, category)
    except Exception as e:
        logger.warning(f"GitHub 搜索失败: {e}，使用兜底数据")
        return _get_fallback_skills(query, category)

    return results


def _parse_repo(repo: dict, category: str = "") -> Optional[dict]:
    """解析 GitHub 仓库为技能"""
    name = repo.get("full_name", repo.get("name", ""))
    desc = (repo.get("description") or "").strip()
    html_url = repo.get("html_url", "")

    # 过滤掉不合适的仓库
    if not desc or len(desc) < 10:
        return None

    skill_id = name.replace("/", "_").replace("-", "_").lower()

    # 推断分类
    inferred_category = category or _infer_category(name, desc)

    # 构建技能
    return {
        "id": f"github_{skill_id}",
        "name": repo.get("name", name),
        "description": desc[:200],
        "category": inferred_category,
        "prompt_template": f"基于 {name} 仓库的技能。原始描述: {desc[:300]}",
        "tags": _extract_tags(name, desc, repo.get("topics", [])),
        "source": "github",
        "installed": False,
        "version": "1.0.0",
        "author": name.split("/")[0] if "/" in name else "",
        "github_url": html_url,
        "stars": repo.get("stargazers_count", 0),
        "language": repo.get("language", ""),
    }


def _infer_category(name: str, desc: str) -> str:
    """从名称和描述推断分类"""
    text = (name + " " + desc).lower()
    if any(kw in text for kw in ["code", "programming", "dev", "python", "js", "typescript"]):
        return "coding"
    if any(kw in text for kw in ["research", "analysis", "analytics", "investigat"]):
        return "research"
    if any(kw in text for kw in ["writing", "documentation", "content", "blog"]):
        return "writing"
    if any(kw in text for kw in ["data", "sql", "visualization", "chart"]):
        return "data"
    if any(kw in text for kw in ["docker", "kubernetes", "deploy", "ci/cd", "ops"]):
        return "devops"
    if any(kw in text for kw in ["design", "ui", "ux", "css", "style"]):
        return "design"
    return "general"


def _extract_tags(name: str, desc: str, topics: list[str]) -> list[str]:
    """提取标签"""
    tags = list(topics[:5]) if topics else []
    name_lower = name.lower()

    tag_keywords = {
        "python": "Python", "javascript": "JavaScript", "typescript": "TypeScript",
        "react": "React", "vue": "Vue", "api": "API", "cli": "CLI",
        "docker": "Docker", "kubernetes": "K8s", "aws": "AWS",
        "database": "数据库", "machine-learning": "机器学习",
        "nlp": "NLP", "vision": "视觉", "audio": "音频",
    }
    for kw, label in tag_keywords.items():
        if kw in name_lower or kw in desc.lower():
            if label not in tags:
                tags.append(label)
    return tags[:8]


def _get_fallback_skills(query: str = "", category: str = "") -> list[dict]:
    """GitHub API 不可用时的兜底技能数据"""
    fallback: list[dict] = [
        {
            "id": "github_awesome_prompts", "name": "Awesome ChatGPT Prompts",
            "description": "精选的 ChatGPT/AI 提示词集合，涵盖写作、编程、创意等多个领域",
            "category": "writing", "source": "github", "installed": False,
            "tags": ["提示词", "Prompt", "ChatGPT", "集合"],
            "author": "f", "github_url": "https://github.com/f/awesome-chatgpt-prompts",
            "stars": 110000, "version": "1.0.0",
            "prompt_template": "使用精选提示词模板，提高 AI 回复质量。",
        },
        {
            "id": "github_langchain_tools", "name": "LangChain Tools",
            "description": "LangChain 框架的工具集合，包含搜索、计算、文件操作等实用工具",
            "category": "coding", "source": "github", "installed": False,
            "tags": ["LangChain", "工具", "Agent", "Python"],
            "author": "langchain-ai", "github_url": "https://github.com/langchain-ai/langchain",
            "stars": 98000, "version": "1.0.0",
            "prompt_template": "利用 LangChain 工具生态系统增强 Agent 能力。",
        },
        {
            "id": "github_agent_gpt", "name": "AgentGPT",
            "description": "浏览器中的自主 AI Agent，可分解目标为子任务并逐步执行",
            "category": "general", "source": "github", "installed": False,
            "tags": ["Agent", "自主", "任务分解", "浏览器"],
            "author": "reworkd", "github_url": "https://github.com/reworkd/AgentGPT",
            "stars": 32000, "version": "1.0.0",
            "prompt_template": "将大目标分解为可执行子任务，逐步推进并监控进度。",
        },
        {
            "id": "github_copilot_prompts", "name": "GitHub Copilot Prompts",
            "description": "高效的 GitHub Copilot 提示词合集，提升代码生成质量和准确性",
            "category": "coding", "source": "github", "installed": False,
            "tags": ["Copilot", "代码生成", "提示词", "编程"],
            "author": "community", "github_url": "https://github.com/topics/copilot-prompt",
            "stars": 5200, "version": "1.0.0",
            "prompt_template": "利用结构化注释引导 AI 生成高质量代码。",
        },
        {
            "id": "github_llm_security", "name": "LLM Security Scanner",
            "description": "LLM/AI 应用的安全扫描和分析工具，检测提示注入和数据泄露风险",
            "category": "devops", "source": "github", "installed": False,
            "tags": ["安全", "LLM", "扫描", "防护"],
            "author": "protectai", "github_url": "https://github.com/protectai/llm-guard",
            "stars": 7800, "version": "1.0.0",
            "prompt_template": "对 AI 生成内容和输入进行安全扫描，防止注入攻击。",
        },
    ]

    # 关键词过滤
    if query:
        q = query.lower()
        fallback = [s for s in fallback
                    if q in s["name"].lower() or q in s["description"].lower()
                    or any(q in t.lower() for t in s.get("tags", []))]
    if category:
        fallback = [s for s in fallback if s.get("category") == category]

    return fallback
