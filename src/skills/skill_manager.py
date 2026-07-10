# -*- coding: utf-8 -*-
"""
技能管理器 —— 技能的存储、加载、CRUD

技能定义:
  - id: 唯一标识
  - name: 技能名称
  - description: 描述
  - category: 分类 (coding/research/writing/data/design/devops/general)
  - prompt_template: 注入 Agent 的提示词片段
  - tags: 标签列表
  - source: 来源 (builtin/github/user)
  - installed: 是否已安装
"""

from __future__ import annotations
import json
import os
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("ai_hubs.skills")

SKILLS_DIR = "./data/skills"


@dataclass
class Skill:
    id: str
    name: str
    description: str = ""
    category: str = "general"
    prompt_template: str = ""
    tags: list[str] = field(default_factory=list)
    source: str = "builtin"  # builtin / github / user
    installed: bool = True
    version: str = "1.0.0"
    author: str = ""
    default_config: dict = field(default_factory=dict)  # 技能默认配置（如参数、环境变量等）

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "prompt_template": self.prompt_template,
            "tags": self.tags,
            "source": self.source,
            "installed": self.installed,
            "version": self.version,
            "author": self.author,
            "default_config": self.default_config,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Skill":
        return cls(
            id=d.get("id", ""),
            name=d.get("name", ""),
            description=d.get("description", ""),
            category=d.get("category", "general"),
            prompt_template=d.get("prompt_template", ""),
            tags=d.get("tags", []),
            source=d.get("source", "builtin"),
            installed=d.get("installed", True),
            version=d.get("version", "1.0.0"),
            author=d.get("author", ""),
            default_config=d.get("default_config", {}),
        )


# ============================================================
# 内置默认技能
# ============================================================

BUILTIN_SKILLS: list[dict] = [
    {
        "id": "python_dev",
        "name": "Python 开发",
        "description": "Python 项目开发、调试、测试、代码审查",
        "category": "coding",
        "prompt_template": "你是 Python 开发专家，精通 Python 3.8+ 语法、类型系统、异步编程。使用 black/isort 风格编写代码，优先使用标准库，必要时推荐第三方库。",
        "tags": ["python", "开发", "调试", "测试"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "web_dev",
        "name": "Web 全栈开发",
        "description": "前端/后端 Web 开发，React/Vue/Node.js/Python 后端",
        "category": "coding",
        "prompt_template": "你是 Web 全栈开发专家。前端优先使用 React + TypeScript + Tailwind CSS，后端推荐 FastAPI 或 Express。代码结构清晰，有适当注释，考虑响应式设计和错误处理。",
        "tags": ["web", "前端", "后端", "全栈", "React", "Vue"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "data_analysis",
        "name": "数据分析",
        "description": "数据处理、清洗、统计分析、可视化",
        "category": "data",
        "prompt_template": "你是数据分析师。使用 pandas/numpy 处理数据，matplotlib/seaborn 可视化。分析前先了解数据结构和分布，给出可操作的洞察。",
        "tags": ["数据分析", "可视化", "统计", "pandas", "matplotlib"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "writing_assistant",
        "name": "文档写作助手",
        "description": "技术文档、报告、邮件、文案撰写和润色",
        "category": "writing",
        "prompt_template": "你是专业的技术写作助手。输出结构清晰、逻辑严谨的文档，使用 Markdown 格式。注意语气得体、用词准确。",
        "tags": ["写作", "文档", "Markdown", "润色", "翻译"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "code_reviewer",
        "name": "代码审查员",
        "description": "代码质量审查、安全漏洞检测、性能优化建议",
        "category": "coding",
        "prompt_template": "你是资深代码审查员。审查规范：1)安全漏洞 2)性能问题 3)代码风格 4)逻辑错误 5)可维护性。给出具体行号和修改建议。",
        "tags": ["代码审查", "安全", "性能", "质量"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "devops_helper",
        "name": "DevOps 运维助手",
        "description": "Docker/K8s 部署、CI/CD 配置、服务器运维",
        "category": "devops",
        "prompt_template": "你是 DevOps 工程师。精通 Docker、Kubernetes、CI/CD 流程。提供生产级配置，考虑安全性、可扩展性和监控。",
        "tags": ["Docker", "Kubernetes", "CI/CD", "部署", "运维"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "research_analyst",
        "name": "调研分析",
        "description": "技术调研、竞品分析、市场研究",
        "category": "research",
        "prompt_template": "你是技术调研分析师。输出结构化的调研报告：背景→现状分析→对比→结论。使用网络搜索获取最新信息，注明信息来源。",
        "tags": ["调研", "分析", "竞品", "市场"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
    {
        "id": "ui_designer",
        "name": "UI 设计顾问",
        "description": "界面设计建议、CSS 样式、用户体验优化",
        "category": "design",
        "prompt_template": "你是 UI/UX 设计顾问。给出简洁现代的设计方案，注重可用性、一致性和视觉层次。使用 Tailwind CSS 或纯 CSS 实现。",
        "tags": ["UI", "UX", "CSS", "设计", "样式"],
        "source": "builtin",
        "version": "1.0.0",
        "author": "AI Hubs",
    },
]


class SkillManager:
    """技能管理器 —— CRUD + 存储"""

    def __init__(self, skills_dir: str = SKILLS_DIR):
        self.skills_dir = skills_dir
        self._skills: dict[str, Skill] = {}
        os.makedirs(skills_dir, exist_ok=True)
        self._load_builtin()
        self._load_user_skills()

    def _load_builtin(self):
        """加载内置技能"""
        for s in BUILTIN_SKILLS:
            skill = Skill.from_dict(s)
            self._skills[skill.id] = skill

    def _load_user_skills(self):
        """加载用户自定义/下载的技能"""
        skills_file = os.path.join(self.skills_dir, "user_skills.json")
        if os.path.exists(skills_file):
            try:
                with open(skills_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    skill = Skill.from_dict(item)
                    if skill.id not in self._skills:
                        self._skills[skill.id] = skill
                logger.info(f"加载了 {len(data)} 个用户技能")
            except Exception as e:
                logger.error(f"加载用户技能失败: {e}")

    def _save_user_skills(self):
        """保存用户技能"""
        skills_file = os.path.join(self.skills_dir, "user_skills.json")
        user_skills = [
            s.to_dict() for s in self._skills.values()
            if s.source in ("github", "user")
        ]
        with open(skills_file, "w", encoding="utf-8") as f:
            json.dump(user_skills, f, ensure_ascii=False, indent=2)

    # ── CRUD ──

    def list_all(self, category: str = "", installed_only: bool = False) -> list[Skill]:
        """列出所有技能"""
        result = list(self._skills.values())
        if category:
            result = [s for s in result if s.category == category]
        if installed_only:
            result = [s for s in result if s.installed]
        return sorted(result, key=lambda s: (0 if s.source == "builtin" else 1, s.name))

    def get(self, skill_id: str) -> Optional[Skill]:
        return self._skills.get(skill_id)

    def install(self, skill_id: str) -> bool:
        """安装技能"""
        s = self._skills.get(skill_id)
        if s:
            s.installed = True
            if s.source != "builtin":
                self._save_user_skills()
            return True
        return False

    def uninstall(self, skill_id: str) -> bool:
        """卸载技能（内置技能不可卸载）"""
        s = self._skills.get(skill_id)
        if s and s.source != "builtin":
            s.installed = False
            self._save_user_skills()
            return True
        return False

    def delete(self, skill_id: str) -> bool:
        """删除技能（内置技能不可删除）"""
        s = self._skills.get(skill_id)
        if s and s.source != "builtin":
            del self._skills[skill_id]
            self._save_user_skills()
            return True
        return False

    def create(self, skill: Skill) -> Skill:
        """创建新技能"""
        self._skills[skill.id] = skill
        self._save_user_skills()
        return skill

    def update(self, skill_id: str, updates: dict) -> Optional[Skill]:
        """更新技能（内置技能不可修改）"""
        s = self._skills.get(skill_id)
        if not s:
            return None
        if s.source == "builtin":
            return None
        # 允许更新的字段
        for field in ["name", "description", "category", "prompt_template", "tags", "version", "default_config"]:
            if field in updates:
                setattr(s, field, updates[field])
        self._save_user_skills()
        return s

    def import_from_dict(self, data: dict) -> Optional[Skill]:
        """从字典导入技能（GitHub 下载等）"""
        skill_id = data.get("id", "")
        if not skill_id:
            return None
        skill = Skill.from_dict(data)
        skill.source = "github"
        self._skills[skill.id] = skill
        self._save_user_skills()
        return skill

    def categories(self) -> list[dict]:
        """技能分类统计"""
        cat_map = {
            "coding": "编程开发",
            "research": "调研分析",
            "writing": "文档写作",
            "data": "数据处理",
            "design": "设计创意",
            "devops": "运维部署",
            "general": "通用助手",
        }
        counts: dict[str, int] = {}
        for s in self._skills.values():
            if s.installed:
                counts[s.category] = counts.get(s.category, 0) + 1
        return [
            {"id": cid, "name": cat_map.get(cid, cid), "count": counts.get(cid, 0)}
            for cid in ["coding", "research", "writing", "data", "design", "devops", "general"]
        ]

    def search(self, query: str) -> list[Skill]:
        """搜索技能"""
        q = query.lower()
        return [
            s for s in self._skills.values()
            if q in s.name.lower() or q in s.description.lower()
            or any(q in t.lower() for t in s.tags)
        ]


# 单例
_skill_manager: Optional[SkillManager] = None


def get_skill_manager() -> SkillManager:
    global _skill_manager
    if _skill_manager is None:
        _skill_manager = SkillManager()
    return _skill_manager
