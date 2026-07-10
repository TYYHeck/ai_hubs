# -*- coding: utf-8 -*-
"""
用户偏好记忆 —— 记住玩家的使用倾向

记录:
  - 常用模型/提供商
  - 常用技能标签
  - 常用 Agent 类型
  - 语言偏好
  - 主题偏好
  - 思考深度偏好
  - 最近使用记录

基于使用频率自动学习用户习惯，下次使用时自动推荐
"""

from __future__ import annotations
import json
import os
import logging
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

logger = logging.getLogger("ai_hubs.prefs")

PREF_DIR = "./data/preferences"
PREF_FILE = os.path.join(PREF_DIR, "user_preferences.json")


@dataclass
class UserPreferences:
    """用户偏好快照"""

    # ── LLM 偏好 ──
    preferred_provider: str = "deepseek"
    preferred_model: str = "deepseek-chat"
    model_usage_count: dict[str, int] = field(default_factory=dict)  # {model_id: count}

    # ── 技能偏好 ──
    favorite_skills: list[str] = field(default_factory=list)  # 最常用技能 ID 列表 (按频率排序)
    skill_usage_count: dict[str, int] = field(default_factory=dict)  # {skill_id: count}

    # ── Agent 偏好 ──
    preferred_agent_type: str = "general"  # general/coding/writing/data/research
    agent_creation_count: dict[str, int] = field(default_factory=dict)  # {category: count}

    # ── 行为偏好 ──
    preferred_thinking_depth: str = "medium"  # low/medium/high
    preferred_thinking_visible: bool = True
    preferred_language: str = "zh"  # zh/en

    # ── UI 偏好 ──
    preferred_theme: str = "dark"
    preferred_font_size: str = "medium"

    # ── 使用统计 ──
    total_sessions: int = 0
    total_messages: int = 0
    total_tasks: int = 0
    last_active_at: str = ""

    # ── 最近使用 ──
    recent_models: list[str] = field(default_factory=list)  # 最近 5 个模型
    recent_skills: list[str] = field(default_factory=list)  # 最近 5 个技能
    recent_agents: list[str] = field(default_factory=list)  # 最近 5 个 Agent


class PreferenceMemory:
    """用户偏好记忆管理器 —— 单例"""

    def __init__(self):
        os.makedirs(PREF_DIR, exist_ok=True)
        self._prefs = self._load()

    def _load(self) -> UserPreferences:
        if os.path.exists(PREF_FILE):
            try:
                with open(PREF_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return UserPreferences(**{
                    k: v for k, v in data.items()
                    if k in UserPreferences.__dataclass_fields__
                })
            except Exception as e:
                logger.warning(f"加载偏好文件失败: {e}")
        return UserPreferences()

    def _save(self):
        try:
            with open(PREF_FILE, "w", encoding="utf-8") as f:
                json.dump(self._prefs.__dict__, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存偏好失败: {e}")

    # ── 记录操作 ──

    def record_model_usage(self, model: str, provider: str):
        """记录模型使用"""
        self._prefs.model_usage_count[model] = self._prefs.model_usage_count.get(model, 0) + 1
        self._prefs.preferred_provider = provider
        self._prefs.preferred_model = model
        # 维护最近使用
        if model in self._prefs.recent_models:
            self._prefs.recent_models.remove(model)
        self._prefs.recent_models.insert(0, model)
        self._prefs.recent_models = self._prefs.recent_models[:5]
        self._save()

    def record_skill_usage(self, skill_id: str):
        """记录技能使用"""
        self._prefs.skill_usage_count[skill_id] = self._prefs.skill_usage_count.get(skill_id, 0) + 1
        if skill_id in self._prefs.recent_skills:
            self._prefs.recent_skills.remove(skill_id)
        self._prefs.recent_skills.insert(0, skill_id)
        self._prefs.recent_skills = self._prefs.recent_skills[:5]
        # 更新最喜爱技能排序
        sorted_skills = sorted(
            self._prefs.skill_usage_count.items(),
            key=lambda x: x[1], reverse=True
        )
        self._prefs.favorite_skills = [s[0] for s in sorted_skills[:10]]
        self._save()

    def record_agent_creation(self, category: str):
        """记录 Agent 创建"""
        self._prefs.agent_creation_count[category] = self._prefs.agent_creation_count.get(category, 0) + 1
        # 更新首选 Agent 类型
        if self._prefs.agent_creation_count:
            self._prefs.preferred_agent_type = max(
                self._prefs.agent_creation_count, key=self._prefs.agent_creation_count.get
            )
        self._save()

    def record_session(self):
        """记录会话"""
        self._prefs.total_sessions += 1
        self._prefs.last_active_at = datetime.now().isoformat()
        self._save()

    def record_message(self):
        """记录一条消息"""
        self._prefs.total_messages += 1
        # 每 10 条消息自动保存一次
        if self._prefs.total_messages % 10 == 0:
            self._save()

    def record_task(self):
        """记录任务"""
        self._prefs.total_tasks += 1
        self._save()

    def record_thinking_preference(self, depth: str, visible: bool):
        """记录思考偏好"""
        self._prefs.preferred_thinking_depth = depth
        self._prefs.preferred_thinking_visible = visible
        self._save()

    def record_ui_preference(self, theme: str | None = None, font_size: str | None = None):
        """记录 UI 偏好"""
        if theme:
            self._prefs.preferred_theme = theme
        if font_size:
            self._prefs.preferred_font_size = font_size
        self._save()

    # ── 查询 ──

    def get_preferences(self) -> UserPreferences:
        return self._prefs

    def get_recommended_model(self) -> tuple[str, str]:
        """获取推荐模型 (model, provider)"""
        return self._prefs.preferred_model, self._prefs.preferred_provider

    def get_recommended_skills(self, top_n: int = 5) -> list[str]:
        """获取推荐技能"""
        return self._prefs.favorite_skills[:top_n]

    def get_recommended_agent_category(self) -> str:
        """获取推荐 Agent 分类"""
        return self._prefs.preferred_agent_type

    def to_dict(self) -> dict:
        return self._prefs.__dict__


# ── 单例 ──

_pref_memory: Optional[PreferenceMemory] = None


def get_preference_memory() -> PreferenceMemory:
    global _pref_memory
    if _pref_memory is None:
        _pref_memory = PreferenceMemory()
    return _pref_memory
