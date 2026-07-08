# -*- coding: utf-8 -*-
"""
记忆系统 —— 让 Agent 记住和理解的存储层

两层架构:
  1. ShortTermMemory  → 当前对话的滑动窗口 + 自动摘要 (基于 LangChain Memory)
  2. LongTermMemory   → 跨会话的持久化记忆 (ChromaDB 向量存储)

LangChain 集成:
  - ShortTermMemory 兼容 ConversationBufferWindowMemory
  - 提供 as_langchain_memory() 方法供 LangChain Agent 使用
"""

from __future__ import annotations
from typing import Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
import uuid
import os
import logging

from ..core.message import Message

logger = logging.getLogger("smart_agent.memory")


# ============================================================
# 1. 短期记忆 - 滑动窗口 + 自动压缩
# ============================================================

@dataclass
class ShortTermMemory:
    """
    当前对话的上下文管理

    机制:
      - 保留最近 max_turns 轮对话 (一轮 = user + assistant)
      - 超出阈值后自动生成摘要，压缩早期对话
      - 始终保留 system prompt
      - 兼容 LangChain 的 ConversationBufferMemory
    """
    max_turns: int = 20
    summarize_threshold: int = 10  # 超过此轮数触发摘要

    _system_message: Optional[Message] = field(default=None, init=False, repr=False)
    _messages: list[Message] = field(default_factory=list, init=False)

    def set_system(self, content: str):
        """设置系统提示词"""
        self._system_message = Message.system(content)

    def add(self, message: Message):
        """添加一条消息"""
        self._messages.append(message)
        self._maybe_compress()

    def add_user(self, content: str) -> Message:
        msg = Message.user(content)
        self.add(msg)
        return msg

    def add_assistant(self, content: str) -> Message:
        msg = Message.assistant(content)
        self.add(msg)
        return msg

    def get_messages(self) -> list[Message]:
        """获取构建 LLM 上下文的消息列表"""
        result: list[Message] = []
        if self._system_message:
            result.append(self._system_message)
        result.extend(self._messages)
        return result

    def get_context_for_llm(self) -> list[dict]:
        """获取 OpenAI 兼容格式的消息列表"""
        return [m.to_llm_format() for m in self.get_messages()]

    def as_langchain_messages(self) -> list:
        """
        转为 LangChain 标准消息列表

        Returns:
            list of langchain_core.messages.BaseMessage
        """
        lc_messages = []
        for msg in self.get_messages():
            lc_msg = msg.to_langchain_message()
            if lc_msg is not None:
                lc_messages.append(lc_msg)
        return lc_messages

    def as_langchain_memory(self):
        """
        转为 LangChain ConversationBufferWindowMemory

        可用于 LangChain Agent 的记忆管理。
        """
        try:
            from langchain.memory import ConversationBufferWindowMemory

            memory = ConversationBufferWindowMemory(
                k=self.max_turns,
                return_messages=True,
                memory_key="chat_history",
                input_key="input",
                output_key="output",
            )

            # 预加载已有消息
            for msg in self._messages:
                lc_msg = msg.to_langchain_message()
                if lc_msg is not None:
                    memory.chat_memory.add_message(lc_msg)

            return memory

        except ImportError:
            logger.warning(
                "langchain 未安装，as_langchain_memory() 不可用"
            )
            return None

    def _maybe_compress(self):
        """当消息过多时，压缩早期对话为摘要"""
        if self.summarize_threshold <= 0:
            return

        turns = [m for m in self._messages
                 if m.role in ("user", "assistant")]

        if len(turns) <= self.summarize_threshold:
            return

        keep_from = max(0, len(self._messages) - self.max_turns)
        old_msgs = self._messages[:keep_from]
        self._messages = self._messages[keep_from:]

        if old_msgs:
            summary = self._summarize(old_msgs)
            self._messages.insert(0, Message(
                role="system",
                content=f"[早期对话摘要]\n{summary}"
            ))

    def _summarize(self, messages: list[Message]) -> str:
        """简单摘要 - 拼接关键信息"""
        parts = []
        for m in messages:
            if m.role == "user":
                parts.append(f"用户: {m.content[:100]}")
            elif m.role == "assistant":
                parts.append(f"助手: {m.content[:100]}")
        return "\n".join(parts[-10:])

    def clear(self):
        """清空记忆"""
        self._messages.clear()

    def __len__(self):
        return len(self._messages)


# ============================================================
# 2. 长期记忆 - 向量数据库持久化
# ============================================================

class LongTermMemory:
    """
    跨会话的持久化记忆

    原理:
      - 每段记忆 → embedding 向量 → 存入 ChromaDB
      - 查询时 → 用已有上下文的 embedding 做语义检索
      - 支持增删改查
      - 可转为 LangChain VectorStore Retriever
    """

    def __init__(
        self,
        db_path: str = "./data/memory.db",
        collection_name: str = "agent_memory",
    ):
        self.db_path = db_path
        self.collection_name = collection_name
        self._collection = None
        self._embedding_func = None

    @property
    def collection(self):
        if self._collection is None:
            import chromadb
            os.makedirs(self.db_path, exist_ok=True)
            client = chromadb.PersistentClient(path=self.db_path)
            self._collection = client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    def add(self, content: str, metadata: dict | None = None,
            memory_id: str | None = None) -> str:
        """存入一条记忆"""
        mid = memory_id or str(uuid.uuid4())[:8]
        meta = metadata or {}
        meta["timestamp"] = datetime.now().isoformat()

        self.collection.add(
            ids=[mid],
            documents=[content],
            metadatas=[meta],
        )
        return mid

    def query(self, query: str, n_results: int = 5) -> list[dict]:
        """语义检索最相关的记忆"""
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results,
            )
            memories = []
            if results["ids"] and results["ids"][0]:
                for i, mid in enumerate(results["ids"][0]):
                    memories.append({
                        "id": mid,
                        "content": results["documents"][0][i],
                        "score": results.get("distances", [[None]])[0][i],
                        "metadata": results.get("metadatas", [[{}]])[0][i],
                    })
            return memories
        except Exception as e:
            return [{"id": "error", "content": f"检索失败: {e}"}]

    def delete(self, memory_id: str):
        """删除一条记忆"""
        self.collection.delete(ids=[memory_id])

    def clear(self):
        """清空所有记忆"""
        try:
            self.collection.delete(where={})
        except Exception:
            pass

    def get_all(self, limit: int = 100) -> list[dict]:
        """获取所有记忆"""
        results = self.collection.get(limit=limit)
        return [
            {"id": rid, "content": doc, "metadata": meta}
            for rid, doc, meta in zip(
                results["ids"],
                results["documents"] or [],
                results["metadatas"] or [],
            )
        ]

    def as_langchain_retriever(self):
        """
        转为 LangChain Retriever 接口

        用于 LangChain Agent 的长期记忆检索。
        """
        try:
            from langchain_chroma import Chroma
            from langchain_openai import OpenAIEmbeddings

            vectorstore = Chroma(
                collection_name=self.collection_name,
                embedding_function=OpenAIEmbeddings(),
                persist_directory=self.db_path,
            )
            return vectorstore.as_retriever(
                search_kwargs={"k": 5}
            )
        except ImportError:
            logger.warning(
                "langchain_chroma 未安装，as_langchain_retriever() 不可用"
            )
            return None


# ============================================================
# 3. 统一记忆管理器
# ============================================================

class MemoryManager:
    """
    记忆管理器 - 统一短期+长期记忆

    API:
      - remember(message)  → 存入短期
      - recall(query)      → 从长期检索
      - save(key, value)   → 存入长期
      - summarize()        → 压缩短期
    """

    def __init__(
        self,
        short_term: ShortTermMemory | None = None,
        long_term: LongTermMemory | None = None,
    ):
        self.short = short_term or ShortTermMemory()
        self.long = long_term

    def set_system(self, content: str):
        self.short.set_system(content)

    def add_message(self, message: Message):
        self.short.add(message)

        # 自动存档重要信息到长期记忆
        if self.long and message.role in ("user", "assistant"):
            if len(message.content) > 20:
                self.long.add(
                    content=message.content,
                    metadata={
                        "role": message.role,
                        "type": "conversation",
                    },
                )

    def get_context(self) -> list[Message]:
        return self.short.get_messages()

    def recall(self, query: str, n: int = 5) -> str:
        """检索相关记忆并格式化返回"""
        if not self.long:
            return ""
        results = self.long.query(query, n)
        if not results or results[0].get("content", "").startswith("检索失败"):
            return ""

        lines = []
        for r in results[:n]:
            lines.append(f"- {r['content'][:200]}")
        return "相关记忆:\n" + "\n".join(lines)

    def as_langchain_memory(self):
        """
        转为 LangChain Memory 组合

        返回可用于 LangChain Agent 的记忆系统。
        """
        return self.short.as_langchain_memory()
