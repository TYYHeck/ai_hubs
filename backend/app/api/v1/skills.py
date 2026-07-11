# -*- coding: utf-8 -*-
"""技能市场 API — CRUD + 安装/卸载 + GitHub 市场检索/安装

技能为全局目录（builtin / github / custom 三类）：
  - builtin: 系统预置，只读。
  - github:  从 GitHub 安装而来。
  - custom:  用户自建，可改可删。
所有登录用户共享同一技能目录（M5 范围）；Agent 通过 skills(JSON) 字段引用技能名。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.skill import Skill
from ...models.user import User
from ...schemas.skill import (
    SkillCreate, SkillResponse, SkillUpdate,
    GithubMarketResponse, GithubInstallRequest,
)
from ...services.skill_service import search_github, install_github_skill
from ..deps import get_current_user

router = APIRouter(prefix="/skills", tags=["Skills"])


# ── 列表 / 详情 ──

@router.get("")
async def list_skills(
    source: str | None = None,       # builtin | github | custom
    category: str | None = None,
    search: str | None = None,
    installed: bool | None = None,   # 仅返回已/未安装
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """列出技能目录（支持筛选）。"""
    stmt = select(Skill)
    if source:
        stmt = stmt.where(Skill.source == source)
    if category:
        stmt = stmt.where(Skill.category == category)
    if search:
        like = f"%{search}%"
        stmt = stmt.where((Skill.name.like(like)) | (Skill.description.like(like)))
    if installed is not None:
        stmt = stmt.where(Skill.is_installed == installed)
    stmt = stmt.order_by(Skill.source, Skill.name)
    skills = (await session.execute(stmt)).scalars().all()
    return [SkillResponse.model_validate(s.to_dict()).model_dump() for s in skills]


@router.get("/{skill_id}")
async def get_skill(
    skill_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    skill = await session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    return SkillResponse.model_validate(skill.to_dict()).model_dump()


# ── 创建（仅 custom） ──

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_skill(
    data: SkillCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    skill = Skill(
        name=data.name,
        description=data.description,
        category=data.category,
        source="custom",
        config=data.config or {},
        is_installed=True,
    )
    # 入口文件名与代码存入 config（与 github 技能一致，便于统一执行/展示）
    skill.config = {**(skill.config or {}), "entry": data.entry or "skill.py", "code": data.code}
    session.add(skill)
    await session.commit()
    await session.refresh(skill)
    return SkillResponse.model_validate(skill.to_dict()).model_dump()


@router.put("/{skill_id}")
async def update_skill(
    skill_id: int,
    data: SkillUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    skill = await session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    if skill.source != "custom":
        raise HTTPException(status_code=400, detail="仅自定义技能可修改")

    update_data = data.model_dump(exclude_unset=True)
    code = update_data.pop("code", None)
    entry = update_data.pop("entry", None)
    for key, value in update_data.items():
        setattr(skill, key, value)
    if code is not None or entry is not None:
        cfg = {**(skill.config or {})}
        if code is not None:
            cfg["code"] = code
        if entry is not None:
            cfg["entry"] = entry
        skill.config = cfg

    await session.commit()
    await session.refresh(skill)
    return SkillResponse.model_validate(skill.to_dict()).model_dump()


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    skill_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    skill = await session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    if skill.source != "custom":
        raise HTTPException(status_code=400, detail="仅自定义技能可删除")
    await session.delete(skill)
    await session.commit()


# ── 安装 / 卸载 ──

@router.post("/{skill_id}/install")
async def install_skill(
    skill_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    skill = await session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    skill.is_installed = True
    from datetime import datetime
    skill.installed_at = datetime.utcnow()
    await session.commit()
    await session.refresh(skill)
    return SkillResponse.model_validate(skill.to_dict()).model_dump()


@router.post("/{skill_id}/uninstall")
async def uninstall_skill(
    skill_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    skill = await session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    skill.is_installed = False
    skill.installed_at = None
    await session.commit()
    await session.refresh(skill)
    return SkillResponse.model_validate(skill.to_dict()).model_dump()


# ── GitHub 市场 ──

@router.get("/market/github", response_model=GithubMarketResponse)
async def market_github(
    q: str = "ai agent skill",
    page: int = 1,
    current_user: User = Depends(get_current_user),
):
    """检索 GitHub 仓库作为潜在技能。网络不可用时返回 error 提示。"""
    result = await search_github(q, page=page)
    return GithubMarketResponse(
        query=q,
        total=result["total"],
        items=result["items"],
        error=result["error"],
    )


@router.post("/market/install")
async def market_install(
    body: GithubInstallRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """从 GitHub 安装技能：拉取代码并落库（source=github）。"""
    try:
        payload = await install_github_skill(
            full_name=body.full_name,
            html_url=body.html_url,
            description=body.description,
            branch=body.branch,
            path=body.path,
            category=body.category,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"安装失败: {e}")

    # 若已存在同名 github 技能则更新
    existing = (await session.execute(
        select(Skill).where(Skill.source == "github", Skill.name == payload["name"])
    )).scalar_one_or_none()

    if existing:
        for k, v in payload.items():
            if k in ("source", "entry"):
                continue
            setattr(existing, k, v)
        existing.config = {**(existing.config or {}), "entry": payload["entry"], "code": payload["code"]}
        existing.is_installed = True
        from datetime import datetime
        existing.installed_at = datetime.utcnow()
        skill = existing
    else:
        skill = Skill(
            name=payload["name"],
            description=payload["description"],
            category=payload["category"],
            source="github",
            github_url=payload["github_url"],
            version=payload["version"],
            config={**(payload["config"] or {}), "entry": payload["entry"], "code": payload["code"]},
            is_installed=True,
        )
        from datetime import datetime
        skill.installed_at = datetime.utcnow()
        session.add(skill)

    await session.commit()
    await session.refresh(skill)
    return SkillResponse.model_validate(skill.to_dict()).model_dump()
