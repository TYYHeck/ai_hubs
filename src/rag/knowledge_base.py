# -*- coding: utf-8 -*-
"""
RAG 知识库 —— 检索增强生成

流程: 文档 → 切片 → Embedding → 向量库 → 检索 → 注入上下文

支持:
  - 多种文档格式 (.txt, .md, .py, .pdf)
  - 语义分块 (按段落) 和固定大小分块
  - OpenAI Embedding (可替换为本地模型)
  - ChromaDB 持久化向量库
"""

from __future__ import annotations
from typing import Any
from dataclasses import dataclass, field
import os
import re


# ============================================================
# 1. 文档加载器
# ============================================================

class DocumentLoader:
    """加载不同类型的文档"""

    @staticmethod
    def load_text(filepath: str) -> str:
        with open(filepath, encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def load_markdown(filepath: str) -> str:
        return DocumentLoader.load_text(filepath)

    @staticmethod
    def load_python(filepath: str) -> str:
        return DocumentLoader.load_text(filepath)

    @staticmethod
    def load_pdf(filepath: str) -> str:
        """加载 PDF (需要 pypdf)"""
        try:
            from pypdf import PdfReader
            reader = PdfReader(filepath)
            text = []
            for page in reader.pages:
                text.append(page.extract_text() or "")
            return "\n\n".join(text)
        except ImportError:
            return f"[需要安装 pypdf: pip install pypdf] 文件: {filepath}"

    @staticmethod
    def load_file(filepath: str) -> str:
        """自动识别文件类型并加载"""
        ext = os.path.splitext(filepath)[1].lower()
        loaders = {
            ".txt": DocumentLoader.load_text,
            ".md": DocumentLoader.load_markdown,
            ".py": DocumentLoader.load_python,
            ".js": DocumentLoader.load_text,
            ".ts": DocumentLoader.load_text,
            ".json": DocumentLoader.load_text,
            ".yaml": DocumentLoader.load_text,
            ".yml": DocumentLoader.load_text,
            ".html": DocumentLoader.load_text,
            ".css": DocumentLoader.load_text,
            ".pdf": DocumentLoader.load_pdf,
        }
        loader = loaders.get(ext)
        if not loader:
            raise ValueError(f"不支持的文件类型: {ext}")
        return loader(filepath)


# ============================================================
# 2. 文本切片器
# ============================================================

class TextSplitter:
    """将长文本拆分为适合检索的小块"""

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def split_by_paragraph(self, text: str) -> list[str]:
        """按段落分块 (适合 Markdown/文章)"""
        paragraphs = re.split(r"\n\s*\n", text)
        chunks = []
        current = ""

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            if len(current) + len(para) > self.chunk_size and current:
                chunks.append(current.strip())
                # 重叠: 保留上一块的尾部
                overlap_text = current[-self.chunk_overlap:] if self.chunk_overlap > 0 else ""
                current = overlap_text + "\n\n" + para
            else:
                if current:
                    current += "\n\n" + para
                else:
                    current = para

        if current.strip():
            chunks.append(current.strip())

        return chunks

    def split_semantic(self, text: str) -> list[str]:
        """语义分割 - 按标题和段落边界"""
        # 先按 Markdown 标题分割
        sections = re.split(r"\n(?=#{1,6}\s)", text)
        chunks = []
        for section in sections:
            if not section.strip():
                continue
            if len(section) <= self.chunk_size:
                chunks.append(section.strip())
            else:
                # 大段再按段落切
                chunks.extend(self.split_by_paragraph(section))
        return chunks


# ============================================================
# 3. 向量知识库
# ============================================================

@dataclass
class KnowledgeBase:
    """
    向量知识库 - 存储文档并支持语义检索

    使用方式:
      kb = KnowledgeBase()
      kb.add_document("doc1", "Python 是一门编程语言...")
      kb.add_file("/path/to/doc.md")

      results = kb.search("什么是 Python？")
    """

    embedding_provider: str = "openai"
    embedding_model: str = "text-embedding-3-small"
    chunk_size: int = 500
    chunk_overlap: int = 50
    persist_dir: str = "./data/vectordb"
    collection_name: str = "knowledge_base"
    top_k: int = 5

    _collection: Any = field(default=None, init=False, repr=False)
    _embedding_client: Any = field(default=None, init=False, repr=False)
    _splitter: TextSplitter = field(default=None, init=False, repr=False)

    def __post_init__(self):
        self._splitter = TextSplitter(self.chunk_size, self.chunk_overlap)

    # ======== ChromaDB 集合 ========
    @property
    def collection(self):
        if self._collection is None:
            import chromadb
            os.makedirs(self.persist_dir, exist_ok=True)
            client = chromadb.PersistentClient(path=self.persist_dir)
            self._collection = client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    # ======== Embedding 获取 ========
    @property
    def embedding_client(self):
        if self._embedding_client is None:
            from openai import OpenAI
            api_key = os.getenv("OPENAI_API_KEY", "")
            self._embedding_client = OpenAI(api_key=api_key)
        return self._embedding_client

    def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        """批量获取 embedding"""
        response = self.embedding_client.embeddings.create(
            model=self.embedding_model,
            input=texts,
        )
        return [d.embedding for d in response.data]

    # ======== 添加文档 ========
    def add_document(
        self,
        source_id: str,
        content: str,
        metadata: dict | None = None,
    ):
        """添加一篇文档到知识库"""
        # 切片
        chunks = self._splitter.split_semantic(content)
        if not chunks:
            return

        # 去重 (已有相同内容不重复添加)
        existing = self.collection.get(
            where={"source_id": source_id}
        )
        existing_chunks = set(existing.get("documents", []))

        new_chunks = [c for c in chunks if c not in existing_chunks]
        if not new_chunks:
            return

        # Embedding + 存储
        embeddings = self._embed_texts(new_chunks)
        meta = metadata or {}
        meta["source_id"] = source_id

        self.collection.add(
            ids=[f"{source_id}_{i}" for i in range(len(new_chunks))],
            documents=new_chunks,
            embeddings=embeddings,
            metadatas=[{**meta, "chunk_idx": i} for i in range(len(new_chunks))],
        )

    def add_file(self, filepath: str, metadata: dict | None = None):
        """加载文件并添加到知识库"""
        content = DocumentLoader.load_file(filepath)
        source_id = os.path.basename(filepath)
        self.add_document(source_id, content, metadata or {})

    # ======== 检索 ========
    def search(self, query: str, top_k: int | None = None) -> list[dict]:
        """语义检索相关文档块"""
        k = top_k or self.top_k

        # 获取查询 embedding
        try:
            query_embedding = self._embed_texts([query])[0]
        except Exception as e:
            return [{"content": f"Embedding 错误: {e}", "score": 0, "source": ""}]

        # 检索
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=k,
        )

        chunks = []
        if results["ids"] and results["ids"][0]:
            for i, chunk_id in enumerate(results["ids"][0]):
                chunks.append({
                    "id": chunk_id,
                    "content": results["documents"][0][i],
                    "score": results.get("distances", [[0]])[0][i],
                    "source": results["metadatas"][0][i].get("source_id", ""),
                })
        return chunks

    def search_formatted(self, query: str, top_k: int | None = None) -> str:
        """检索并格式化为可注入 LLM 的上下文"""
        results = self.search(query, top_k)
        if not results:
            return ""

        parts = []
        for i, r in enumerate(results, 1):
            src = f" (来源: {r['source']})" if r["source"] else ""
            parts.append(f"[文档块 {i}{src}]\n{r['content']}")

        return "\n\n".join(parts)

    # ======== 管理 ========
    def clear(self):
        """清空知识库"""
        try:
            self.collection.delete(where={})
        except Exception:
            pass

    def stats(self) -> dict:
        """知识库统计"""
        try:
            count = self.collection.count()
        except Exception:
            count = 0
        return {
            "chunks": count,
            "sources": len(set(
                m.get("source_id", "") for m in self.collection.get().get("metadatas", [])
            )),
        }
