# -*- coding: utf-8 -*-
"""技能市场路由 —— 技能 CRUD + GitHub 搜索"""

from __future__ import annotations
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/skills", tags=["技能市场"])


class CreateSkillRequest(BaseModel):
    id: str = Field(..., description="技能 ID")
    name: str = Field(..., min_length=1, max_length=64)
    description: str = ""
    category: str = "general"
    prompt_template: str = ""
    tags: list[str] = []


class ImportSkillRequest(BaseModel):
    data: dict = Field(..., description="从 GitHub 导入的技能数据")


@router.get("/list")
async def list_skills(
    category: str = Query("", description="技能分类"),
    installed_only: bool = Query(False, description="仅显示已安装"),
):
    """获取技能列表"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    skills = mgr.list_all(category=category, installed_only=installed_only)
    return {
        "ok": True,
        "skills": [s.to_dict() for s in skills],
        "categories": mgr.categories(),
    }


@router.get("/{skill_id}")
async def get_skill(skill_id: str):
    """获取单个技能"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    skill = mgr.get(skill_id)
    if not skill:
        return {"ok": False, "error": "技能不存在"}
    return {"ok": True, "skill": skill.to_dict()}


@router.post("/{skill_id}/install")
async def install_skill(skill_id: str):
    """安装技能"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    if mgr.install(skill_id):
        return {"ok": True, "message": "技能已安装"}
    return {"ok": False, "error": "技能不存在"}


@router.post("/{skill_id}/uninstall")
async def uninstall_skill(skill_id: str):
    """卸载技能"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    if mgr.uninstall(skill_id):
        return {"ok": True, "message": "技能已卸载"}
    return {"ok": False, "error": "卸载失败（内置技能不可卸载）"}


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    """删除技能"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    if mgr.delete(skill_id):
        return {"ok": True, "message": "技能已删除"}
    return {"ok": False, "error": "删除失败（内置技能不可删除）"}


@router.post("/create")
async def create_skill(req: CreateSkillRequest):
    """创建自定义技能"""
    from src.skills.skill_manager import get_skill_manager, Skill

    mgr = get_skill_manager()
    if mgr.get(req.id):
        return {"ok": False, "error": "技能 ID 已存在"}

    skill = Skill(
        id=req.id,
        name=req.name,
        description=req.description,
        category=req.category,
        prompt_template=req.prompt_template,
        tags=req.tags,
        source="user",
    )
    mgr.create(skill)
    return {"ok": True, "skill": skill.to_dict()}


@router.get("/github/search")
async def search_github(
    q: str = Query("", description="搜索关键词"),
    category: str = Query("", description="分类筛选"),
    page: int = Query(1, ge=1, le=5),
):
    """从 GitHub 搜索技能"""
    from src.skills.github_scanner import search_github_skills

    results = search_github_skills(query=q, category=category, page=page, per_page=10)
    return {"ok": True, "skills": results, "total": len(results)}


@router.post("/github/import")
async def import_from_github(req: ImportSkillRequest):
    """从 GitHub 导入技能"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    skill = mgr.import_from_dict(req.data)
    if skill:
        return {"ok": True, "skill": skill.to_dict()}
    return {"ok": False, "error": "导入失败：数据格式不正确"}


@router.get("/categories/list")
async def categories():
    """技能分类列表"""
    from src.skills.skill_manager import get_skill_manager

    mgr = get_skill_manager()
    return {"ok": True, "categories": mgr.categories()}
