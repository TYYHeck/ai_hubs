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
import logging

logger = logging.getLogger("ai_hubs.rag")


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

    # ======== 检索结果压缩 ========

    def compress_results(
        self,
        results: list[dict],
        method: str = "extractive",
        max_tokens: int = 2048,
    ) -> str:
        """压缩检索结果以减少上下文内存占用

        Args:
            results: search() 返回的结果列表
            method: 压缩方法
                - "extractive": 提取最相关句子（默认，快速无损）
                - "summary": 使用 LLM 生成摘要（需 API 调用，高压缩率）
                - "hybrid": 先提取再摘要（平衡）
            max_tokens: 压缩后最大 token 数（估算：1 token ≈ 0.75 中文/4 英文）
        """
        if not results:
            return ""

        # 合并所有结果
        combined = "\n\n---\n\n".join(
            f"[来源: {r.get('source', '未知')} | 相关度: {1 - r.get('score', 0):.2f}]\n{r.get('content', '')}"
            for r in results
        )

        # 估算当前 token 数
        estimated_tokens = len(combined) // 2  # 粗略估算

        if estimated_tokens <= max_tokens:
            return combined  # 无需压缩

        if method == "extractive":
            return self._extractive_compress(results, max_tokens)
        elif method == "summary":
            return self._summary_compress(combined, max_tokens)
        elif method == "hybrid":
            extracted = self._extractive_compress(results, max_tokens * 2)
            return self._summary_compress(extracted, max_tokens)
        else:
            return self._extractive_compress(results, max_tokens)

    def _extractive_compress(self, results: list[dict], max_tokens: int) -> str:
        """提取式压缩：从每个结果中提取最相关的关键句"""
        import re

        max_chars = max_tokens * 2  # 粗略估算
        compressed_parts: list[str] = []
        remaining = max_chars

        # 按相关度排序（score 越小越相关）
        sorted_results = sorted(results, key=lambda r: r.get("score", 1))

        for r in sorted_results:
            if remaining <= 0:
                break

            source = r.get("source", "")
            content = r.get("content", "")
            score = r.get("score", 0)

            # 提取关键句：包含关键词的句子 + 首尾句
            sentences = re.split(r'(?<=[。！？.!?\n])', content)
            if len(sentences) <= 3:
                # 内容很短，直接保留
                part = f"[{source}] {content.strip()}"
            else:
                # 取前 2 句 + 最后 1 句
                key_sentences = sentences[:2] + [sentences[-1]]
                part = f"[{source}] {' '.join(s.strip() for s in key_sentences if s.strip())}"

            if len(part) > remaining:
                part = part[:remaining] + "..."

            compressed_parts.append(part)
            remaining -= len(part)

        return "\n\n".join(compressed_parts)

    def _summary_compress(self, text: str, max_tokens: int) -> str:
        """摘要式压缩：使用 LLM 生成摘要（需要 API 调用）"""
        try:
            from openai import OpenAI
            api_key = os.getenv("OPENAI_API_KEY", "") or os.getenv("DEEPSEEK_API_KEY", "")
            if not api_key:
                logger.warning("摘要压缩需要 API Key，回退到提取式压缩")
                return text[:max_tokens * 2]

            client = OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{
                    "role": "system",
                    "content": "你是一个文本压缩助手。请将以下检索结果压缩为简洁的摘要，保留所有关键信息和来源。"
                }, {
                    "role": "user",
                    "content": f"请压缩以下内容，保留关键信息（来源、核心事实、关键数据）：\n\n{text[:8000]}"
                }],
                max_tokens=min(max_tokens, 2048),
                temperature=0.3,
            )
            return response.choices[0].message.content or text[:max_tokens * 2]
        except Exception as e:
            logger.warning(f"摘要压缩失败: {e}，回退到提取式压缩")
            return text[:max_tokens * 2]

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

    def search_formatted(
        self, query: str, top_k: int | None = None,
        compress: bool = True, compression_method: str = "extractive",
    ) -> str:
        """检索并格式化为可注入 LLM 的上下文

        Args:
            query: 搜索查询
            top_k: 返回结果数
            compress: 是否启用压缩（减少内存占用）
            compression_method: 压缩方法 (extractive/summary/hybrid)
        """
        results = self.search(query, top_k)
        if not results:
            return ""

        if compress:
            # 使用压缩后返回
            return self.compress_results(results, method=compression_method)

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
