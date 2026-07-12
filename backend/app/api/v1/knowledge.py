# -*- coding: utf-8 -*-
"""知识库 API v2 — 多知识库管理 + 文档上传/检索/删除"""

import os
import logging
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models.knowledge import KnowledgeBase, KnowledgeDoc
from ...models.user import User
from ..deps import get_current_user

logger = logging.getLogger("ai_hubs.knowledge_api")

router = APIRouter(prefix="/knowledge", tags=["Knowledge"])

_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".txt", ".md", ".py", ".js", ".ts", ".json", ".yaml", ".yml", ".html", ".css", ".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".php", ".rb"}
MAX_FILE_SIZE = 50 * 1024 * 1024


def _get_kb_instance(kb_config: KnowledgeBase):
    """获取知识库实例（ChromaDB + Embedding）"""
    try:
        import sys
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))
        from src.rag.knowledge_base import KnowledgeBase as KBEngine
        
        persist_dir = project_root / "data" / "vectordb" / f"kb_{kb_config.id}"
        kb = KBEngine(
            embedding_provider=kb_config.embedding_provider,
            embedding_model=kb_config.embedding_model,
            chunk_size=kb_config.chunk_size,
            chunk_overlap=kb_config.chunk_overlap,
            persist_dir=str(persist_dir),
            collection_name=f"kb_{kb_config.id}",
            top_k=kb_config.top_k,
        )
        return kb
    except Exception as e:
        logger.error(f"知识库初始化失败 (kb_id={kb_config.id}): {e}")
        return None


def _validate_ext(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {ext}。支持: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    return ext


async def _ensure_default_kb(user_id: int, session: AsyncSession) -> KnowledgeBase:
    """确保用户有默认知识库，没有则创建"""
    stmt = select(KnowledgeBase).where(
        KnowledgeBase.user_id == user_id,
        KnowledgeBase.is_default == 1
    )
    kb = (await session.execute(stmt)).scalar_one_or_none()
    if kb:
        return kb
    
    new_kb = KnowledgeBase(
        user_id=user_id,
        name="默认知识库",
        description="系统默认创建的知识库",
        category="general",
        is_default=1,
    )
    session.add(new_kb)
    await session.commit()
    await session.refresh(new_kb)
    return new_kb


async def _get_user_kb(kb_id: int, user_id: int, session: AsyncSession) -> KnowledgeBase:
    """获取用户的知识库，不存在或不属于用户则抛 404"""
    kb = await session.get(KnowledgeBase, kb_id)
    if not kb or kb.user_id != user_id:
        raise HTTPException(status_code=404, detail="知识库不存在")
    return kb


async def _recalc_kb_counts(kb_id: int, session: AsyncSession):
    """重新计算知识库的文档数和分块数"""
    kb = await session.get(KnowledgeBase, kb_id)
    if not kb:
        return
    
    doc_cnt = (await session.execute(
        select(func.count()).select_from(KnowledgeDoc).where(KnowledgeDoc.kb_id == kb_id)
    )).scalar_one()
    kb.doc_count = doc_cnt
    
    chunk_cnt = (await session.execute(
        select(func.coalesce(func.sum(KnowledgeDoc.chunk_count), 0)).where(KnowledgeDoc.kb_id == kb_id)
    )).scalar_one()
    kb.chunk_count = chunk_cnt
    
    await session.commit()


# ============================================================
# 知识库 CRUD
# ============================================================

@router.get("/bases")
async def list_knowledge_bases(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取用户的所有知识库列表"""
    await _ensure_default_kb(current_user.id, session)
    
    stmt = select(KnowledgeBase).where(
        KnowledgeBase.user_id == current_user.id
    ).order_by(KnowledgeBase.is_default.desc(), KnowledgeBase.updated_at.desc())
    
    kbs = (await session.execute(stmt)).scalars().all()
    return [kb.to_dict() for kb in kbs]


@router.post("/bases", status_code=201)
async def create_knowledge_base(
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """创建新知识库"""
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="知识库名称不能为空")
    
    kb = KnowledgeBase(
        user_id=current_user.id,
        name=name,
        description=data.get("description", ""),
        category=data.get("category", "general"),
        embedding_provider=data.get("embedding_provider", "openai"),
        embedding_model=data.get("embedding_model", "text-embedding-3-small"),
        chunk_size=data.get("chunk_size", 500),
        chunk_overlap=data.get("chunk_overlap", 50),
        top_k=data.get("top_k", 5),
    )
    session.add(kb)
    await session.commit()
    await session.refresh(kb)
    return kb.to_dict()


@router.get("/bases/{kb_id}")
async def get_knowledge_base(
    kb_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取单个知识库详情"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    return kb.to_dict()


@router.put("/bases/{kb_id}")
async def update_knowledge_base(
    kb_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """更新知识库配置"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    
    if "name" in data and data["name"]:
        kb.name = data["name"]
    if "description" in data:
        kb.description = data["description"]
    if "category" in data:
        kb.category = data["category"]
    if "embedding_provider" in data:
        kb.embedding_provider = data["embedding_provider"]
    if "embedding_model" in data:
        kb.embedding_model = data["embedding_model"]
    if "chunk_size" in data:
        kb.chunk_size = data["chunk_size"]
    if "chunk_overlap" in data:
        kb.chunk_overlap = data["chunk_overlap"]
    if "top_k" in data:
        kb.top_k = data["top_k"]
    if "is_default" in data:
        if data["is_default"]:
            from sqlalchemy import update
            await session.execute(
                update(KnowledgeBase)
                .where(KnowledgeBase.user_id == current_user.id)
                .values(is_default=0)
            )
            kb.is_default = 1
        else:
            kb.is_default = 0
    
    await session.commit()
    await session.refresh(kb)
    return kb.to_dict()


@router.delete("/bases/{kb_id}", status_code=204)
async def delete_knowledge_base(
    kb_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除知识库（不能删除默认知识库，除非是最后一个）"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    
    total = (await session.execute(
        select(func.count()).select_from(KnowledgeBase).where(KnowledgeBase.user_id == current_user.id)
    )).scalar_one()
    
    if total <= 1:
        raise HTTPException(status_code=400, detail="至少需要保留一个知识库")
    
    if kb.is_default:
        raise HTTPException(status_code=400, detail="不能删除默认知识库，请先设其他知识库为默认")
    
    await session.delete(kb)
    await session.commit()


# ============================================================
# 文档管理
# ============================================================

@router.get("/bases/{kb_id}/docs")
async def list_kb_docs(
    kb_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """获取知识库的文档列表"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    
    stmt = select(KnowledgeDoc).where(
        KnowledgeDoc.kb_id == kb_id
    ).order_by(KnowledgeDoc.created_at.desc())
    
    docs = (await session.execute(stmt)).scalars().all()
    return [doc.to_dict() for doc in docs]


@router.post("/bases/{kb_id}/upload")
async def upload_to_kb(
    kb_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """上传文档到指定知识库"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    kb_engine = _get_kb_instance(kb)
    
    if kb_engine is None:
        raise HTTPException(status_code=500, detail="知识库初始化失败，请检查 Embedding API 配置")
    
    kb_upload_dir = _UPLOAD_DIR / f"kb_{kb_id}"
    kb_upload_dir.mkdir(parents=True, exist_ok=True)
    
    results = []
    for f in files:
        if not f.filename:
            continue
        
        try:
            ext = _validate_ext(f.filename)
        except HTTPException as e:
            results.append({"file": f.filename, "ok": False, "error": e.detail})
            continue
        
        safe_name = f.filename.replace("\\", "_").replace("/", "_")
        filepath = kb_upload_dir / safe_name
        content_bytes = await f.read()
        
        if len(content_bytes) > MAX_FILE_SIZE:
            results.append({"file": f.filename, "ok": False, "error": f"文件超过 {MAX_FILE_SIZE // 1024 // 1024}MB 限制"})
            continue
        
        with open(filepath, "wb") as out:
            out.write(content_bytes)
        
        try:
            import sys
            project_root = Path(__file__).resolve().parent.parent.parent.parent
            if str(project_root) not in sys.path:
                sys.path.insert(0, str(project_root))
            from src.rag.knowledge_base import DocumentLoader
            content = DocumentLoader.load_file(str(filepath))
        except Exception as e:
            results.append({"file": f.filename, "ok": False, "error": f"文件加载失败: {e}"})
            continue
        
        source_id = f"doc_{kb_id}_{safe_name.replace('.', '_')}"
        
        try:
            kb_engine.add_document(source_id, content, {
                "filename": safe_name,
                "ext": ext,
                "size": len(content_bytes),
                "path": str(filepath),
                "kb_id": kb_id,
            })
            
            chunks = kb_engine.collection.get(where={"source_id": source_id})
            chunk_count = len(chunks.get("ids", []))
            
            doc_stmt = select(KnowledgeDoc).where(
                KnowledgeDoc.kb_id == kb_id,
                KnowledgeDoc.source_id == source_id
            )
            existing_doc = (await session.execute(doc_stmt)).scalar_one_or_none()
            
            if existing_doc:
                existing_doc.file_size = len(content_bytes)
                existing_doc.chunk_count = chunk_count
                existing_doc.file_path = str(filepath)
            else:
                doc = KnowledgeDoc(
                    kb_id=kb_id,
                    user_id=current_user.id,
                    source_id=source_id,
                    filename=safe_name,
                    file_path=str(filepath),
                    file_size=len(content_bytes),
                    file_type=ext.lstrip("."),
                    chunk_count=chunk_count,
                )
                session.add(doc)
            
            results.append({"file": f.filename, "ok": True, "chunks": chunk_count})
        except Exception as e:
            logger.error(f"添加文档失败: {e}")
            results.append({"file": f.filename, "ok": False, "error": f"添加失败: {e}"})
    
    await session.commit()
    await _recalc_kb_counts(kb_id, session)
    
    return {"ok": all(r["ok"] for r in results), "results": results}


@router.delete("/bases/{kb_id}/docs/{doc_id}", status_code=204)
async def delete_kb_doc(
    kb_id: int,
    doc_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除知识库中的文档"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    
    doc = await session.get(KnowledgeDoc, doc_id)
    if not doc or doc.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    kb_engine = _get_kb_instance(kb)
    if kb_engine:
        try:
            kb_engine.collection.delete(where={"source_id": doc.source_id})
        except Exception as e:
            logger.warning(f"向量库删除失败: {e}")
    
    try:
        if os.path.exists(doc.file_path):
            os.remove(doc.file_path)
    except Exception:
        pass
    
    await session.delete(doc)
    await session.commit()
    await _recalc_kb_counts(kb_id, session)


@router.post("/bases/{kb_id}/search")
async def search_kb(
    kb_id: int,
    body: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """在指定知识库中检索"""
    kb = await _get_user_kb(kb_id, current_user.id, session)
    kb_engine = _get_kb_instance(kb)
    
    if kb_engine is None:
        return []
    
    query = body.get("query", "")
    top_k = body.get("top_k", kb.top_k)
    
    try:
        results = kb_engine.search(query, top_k=top_k)
        
        doc_map = {}
        stmt = select(KnowledgeDoc).where(KnowledgeDoc.kb_id == kb_id)
        docs = (await session.execute(stmt)).scalars().all()
        for d in docs:
            doc_map[d.source_id] = d.id
        
        formatted = []
        for r in results:
            source = r.get("source", "")
            formatted.append({
                "text": r["content"],
                "score": r["score"],
                "source": source,
                "chunk_id": r["id"],
                "doc_id": doc_map.get(source),
            })
        return formatted
    except Exception as e:
        logger.error(f"知识库检索失败: {e}")
        return []


# ============================================================
# 兼容旧版 API（单知识库模式，使用默认知识库）
# ============================================================

@router.get("/docs")
async def api_knowledge_docs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """兼容旧版：获取默认知识库的文档列表"""
    kb = await _ensure_default_kb(current_user.id, session)
    
    stmt = select(KnowledgeDoc).where(
        KnowledgeDoc.kb_id == kb.id
    ).order_by(KnowledgeDoc.created_at.desc())
    
    docs = (await session.execute(stmt)).scalars().all()
    return [doc.to_dict() for doc in docs]


@router.post("/upload")
async def api_upload_knowledge(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """兼容旧版：上传到默认知识库"""
    kb = await _ensure_default_kb(current_user.id, session)
    return await upload_to_kb(kb.id, files, current_user, session)


@router.post("/search")
async def api_knowledge_search(
    body: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """兼容旧版：在默认知识库中检索"""
    kb = await _ensure_default_kb(current_user.id, session)
    return await search_kb(kb.id, body, current_user, session)


@router.delete("/docs/{doc_id}")
async def api_delete_knowledge(
    doc_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """兼容旧版：从默认知识库删除文档（按 source_id）"""
    kb = await _ensure_default_kb(current_user.id, session)
    
    stmt = select(KnowledgeDoc).where(
        KnowledgeDoc.kb_id == kb.id,
        KnowledgeDoc.source_id == doc_id
    )
    doc = (await session.execute(stmt)).scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    await delete_kb_doc(kb.id, doc.id, current_user, session)
    return {"ok": True}
