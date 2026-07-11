# -*- coding: utf-8 -*-
"""知识库 API — 文件上传/列表/检索/清空"""

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from ..deps import get_current_user

router = APIRouter(prefix="/knowledge", tags=["Knowledge"])

_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "data", "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".txt", ".md", ".py", ".js", ".ts", ".json", ".yaml", ".yml", ".html", ".css", ".pdf"}
MAX_FILE_SIZE = 20 * 1024 * 1024


def _get_kb():
    try:
        import sys
        from pathlib import Path
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))
        from src.rag.knowledge_base import KnowledgeBase
        return KnowledgeBase()
    except Exception as e:
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"知识库初始化失败: {e}")
        return None


def _validate_ext(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}。支持: {', '.join(sorted(ALLOWED_EXTENSIONS))}")
    return ext


@router.get("/docs")
async def api_knowledge_docs(current_user = Depends(get_current_user)):
    kb = _get_kb()
    if kb is None:
        return []
    sources = []
    try:
        all_data = kb.collection.get()
        if all_data and all_data.get("metadatas"):
            source_map: dict[str, dict] = {}
            for meta in all_data["metadatas"]:
                sid = meta.get("source_id", "unknown")
                if sid not in source_map:
                    source_map[sid] = {"id": sid, "name": meta.get("filename", sid), "path": meta.get("path", ""), "size": meta.get("size", 0), "chunks": 0, "created_at": meta.get("created_at", "")}
                source_map[sid]["chunks"] += 1
            sources = sorted(source_map.values(), key=lambda s: s["chunks"], reverse=True)
    except Exception as e:
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"知识库查询失败: {e}")
    return sources


@router.post("/upload")
async def api_upload_knowledge(files: list[UploadFile] = File(...), current_user = Depends(get_current_user)):
    kb = _get_kb()
    if kb is None:
        raise HTTPException(status_code=500, detail="知识库初始化失败，请检查 OpenAI API 配置")
    
    os.makedirs(_UPLOAD_DIR, exist_ok=True)
    results = []
    for f in files:
        if not f.filename:
            continue
        ext = _validate_ext(f.filename)
        safe_name = f.filename.replace("\\", "_").replace("/", "_")
        filepath = os.path.join(_UPLOAD_DIR, safe_name)
        content_bytes = await f.read()
        if len(content_bytes) > MAX_FILE_SIZE:
            results.append({"file": f.filename, "ok": False, "error": "文件超过 20MB 限制"})
            continue
        with open(filepath, "wb") as out:
            out.write(content_bytes)
        try:
            from src.rag.knowledge_base import DocumentLoader
            content = DocumentLoader.load_file(filepath)
        except Exception as e:
            results.append({"file": f.filename, "ok": False, "error": f"文件加载失败: {e}"})
            continue
        try:
            kb.add_document(safe_name, content, {"filename": safe_name, "ext": ext, "size": len(content_bytes), "path": filepath})
            results.append({"file": f.filename, "ok": True})
        except Exception as e:
            results.append({"file": f.filename, "ok": False, "error": f"添加失败: {e}"})
    return {"ok": all(r["ok"] for r in results), "results": results}


@router.post("/search")
async def api_knowledge_search(query: dict, current_user = Depends(get_current_user)):
    kb = _get_kb()
    if kb is None:
        return []
    try:
        results = kb.search(query.get("query", ""))
        return [{"text": r["content"], "score": r["score"], "source": r["source"], "chunk_id": r["id"]} for r in results]
    except Exception as e:
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"知识库检索失败: {e}")
        return []


@router.delete("/docs/{doc_id}")
async def api_delete_knowledge(doc_id: str, current_user = Depends(get_current_user)):
    kb = _get_kb()
    if kb is None:
        raise HTTPException(status_code=500, detail="知识库初始化失败")
    try:
        kb.collection.delete(where={"source_id": doc_id})
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
