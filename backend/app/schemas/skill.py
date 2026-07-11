# -*- coding: utf-8 -*-
"""技能 Pydantic 模型 — CRUD / 市场 / 安装"""

from typing import Any, Optional

from pydantic import BaseModel, Field


class SkillCreate(BaseModel):
    """创建自定义技能（source=custom）"""
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    category: str = "general"
    entry: str = ""          # 入口文件名，如 skill.py / index.js
    code: str = ""           # 技能实现代码
    config: dict = {}


class SkillUpdate(BaseModel):
    """更新技能（仅 custom 可改代码/配置）"""
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    category: Optional[str] = None
    entry: Optional[str] = None
    code: Optional[str] = None
    config: Optional[dict] = None


class SkillResponse(BaseModel):
    id: int
    name: str
    description: str
    category: str
    source: str              # builtin | github | custom
    github_url: Optional[str] = None
    version: str
    config: dict = {}
    is_installed: bool
    installed_at: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


# ── GitHub 市场 ──

class GithubSkill(BaseModel):
    """GitHub 仓库（作为潜在技能）"""
    full_name: str
    name: str
    description: str = ""
    html_url: str
    stars: int = 0
    language: Optional[str] = None
    default_branch: str = "main"


class GithubMarketResponse(BaseModel):
    query: str
    total: int
    items: list[GithubSkill] = []
    error: Optional[str] = None


class GithubInstallRequest(BaseModel):
    """从 GitHub 安装技能：拉取仓库中的技能文件并落库"""
    full_name: str = Field(..., min_length=1)
    html_url: str = ""
    description: str = ""
    branch: str = ""
    path: str = ""           # 可选，指定入口文件；缺省自动探测
    category: str = "github"
