# -*- coding: utf-8 -*-
"""
记忆管理器 — 多层记忆保障（对应需求「减少 AI 幻觉」）

核心能力：
  1. VCS 式版本控制：每轮对话/任务提交一个 commit（parent_hash 链式），支持回退
  2. 关键词索引 + 重要性：记忆条目带关键词，构成「记忆图谱」节点，支持快速检索
  3. 高无损压缩：旧记忆经 LLM 摘要压缩为长期记忆，降低 token 开销、加快读取
  4. 上下文构建：近期窗口 + 相关性检索 + 压缩摘要，按记忆强度与 token 预算组装

零配置可用：默认纯关键词检索；可选 jieba 提升中文分词；无需向量数据库。
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select, func, desc, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import create_session
from ..models.memory import (
    MemoryBranch,
    MemoryCommit,
    MemoryEntry,
    MemorySnapshot,
)
from ..core.llm import llm_manager
from ..core.tokenize import keywords as extract_keywords

logger = logging.getLogger("ai_hubs.memory")


def _estimate_tokens(text: str) -> int:
    """粗略 token 估算：CJK 约 1 token/字，英文约 1 token/4 字符。"""
    cjk = len(re.findall(r"[一-鿿]", text))
    other = len(text) - cjk
    return cjk + other // 4 + 1


def _make_hash(user_id: int, agent_name: str) -> str:
    raw = f"{user_id}:{agent_name}:{time.time()}:{os.urandom(4).hex()}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


class MemoryManager:
    """记忆管理器（单例）"""

    # ── 分支管理 ──────────────────────────────────────────

    async def _get_branch(
        self, session: AsyncSession, user_id: int, agent_name: str
    ) -> Optional[MemoryBranch]:
        res = await session.execute(
            select(MemoryBranch).where(
                MemoryBranch.user_id == user_id,
                MemoryBranch.agent_name == agent_name,
            )
        )
        return res.scalar_one_or_none()

    async def _ensure_branch(
        self, session: AsyncSession, user_id: int, agent_name: str, head_hash: str
    ) -> MemoryBranch:
        branch = await self._get_branch(session, user_id, agent_name)
        if branch is None:
            branch = MemoryBranch(
                user_id=user_id, agent_name=agent_name, head_hash=head_hash
            )
            session.add(branch)
            await session.flush()
        return branch

    async def _next_seq(self, session: AsyncSession, user_id: int, agent_name: str) -> int:
        res = await session.execute(
            select(func.max(MemoryEntry.seq)).where(
                MemoryEntry.user_id == user_id,
                MemoryEntry.agent_name == agent_name,
            )
        )
        cur = res.scalar()
        return (cur or 0) + 1

    # ── 写入：添加一轮对话/任务记忆 ───────────────────────

    async def add_turn(
        self,
        user_id: int,
        agent_name: str,
        messages: list[dict],
        message: str = "conversation turn",
        commit_type: str = "turn",
        auto_compress: bool = True,
    ) -> dict:
        """
        将一轮 messages 写入记忆，生成一个 git 式 commit。

        messages: [{"role": "user"/"assistant"/"system", "content": "..."}]
        返回该 commit 的 to_dict()。
        """
        async with create_session() as session:
            # 当前 HEAD
            branch = await self._get_branch(session, user_id, agent_name)
            parent_hash = branch.head_hash if branch else None

            commit_hash = _make_hash(user_id, agent_name)
            seq = await self._next_seq(session, user_id, agent_name)

            entries = []
            for m in messages:
                role = m.get("role", "user")
                content = m.get("content", "")
                if not content:
                    continue
                kw = extract_keywords(content)
                imp = self._estimate_importance(role, content)
                entry = MemoryEntry(
                    user_id=user_id,
                    agent_name=agent_name,
                    role=role,
                    content=content,
                    keywords=kw,
                    importance=imp,
                    seq=seq,
                )
                session.add(entry)
                entries.append(entry)
                seq += 1

            commit = MemoryCommit(
                user_id=user_id,
                agent_name=agent_name,
                commit_hash=commit_hash,
                message=message[:256],
                parent_hash=parent_hash,
                message_count=len(entries),
                commit_type=commit_type,
            )
            session.add(commit)
            await session.flush()

            # 关联 entries → commit
            for e in entries:
                e.commit_id = commit.id

            # 快照
            snapshot = MemorySnapshot(
                commit_id=commit.id,
                data={
                    "entries": [
                        {"role": e.role, "content": e.content, "keywords": e.keywords}
                        for e in entries
                    ]
                },
            )
            session.add(snapshot)

            # 更新 HEAD
            await self._ensure_branch(session, user_id, agent_name, commit_hash)

            # 自动压缩（防止记忆无限膨胀）
            if auto_compress and commit_type == "turn":
                await self._maybe_compress(session, user_id, agent_name)

            await session.commit()
            return commit.to_dict()

    @staticmethod
    def _estimate_importance(role: str, content: str) -> float:
        """基于角色与长度粗估重要性（0-5）。"""
        base = 1.0
        if role == "system":
            base = 4.0
        elif role == "assistant":
            base = 2.0
        # 较长内容通常信息量更大
        if len(content) > 200:
            base += 1.0
        if len(content) > 800:
            base += 1.0
        return min(base, 5.0)

    # ── 压缩：高无损压缩旧记忆 ─────────────────────────────

    async def _maybe_compress(
        self, session: AsyncSession, user_id: int, agent_name: str, threshold: int = 40
    ) -> Optional[dict]:
        """当未压缩条目超过阈值时，将最旧的低重要性条目压缩为摘要。"""
        res = await session.execute(
            select(func.count(MemoryEntry.id)).where(
                MemoryEntry.user_id == user_id,
                MemoryEntry.agent_name == agent_name,
                MemoryEntry.compressed.is_(False),
            )
        )
        count = res.scalar() or 0
        if count < threshold:
            return None

        # 取最旧的一半低重要性条目压缩
        res = await session.execute(
            select(MemoryEntry)
            .where(
                MemoryEntry.user_id == user_id,
                MemoryEntry.agent_name == agent_name,
                MemoryEntry.compressed.is_(False),
                MemoryEntry.role != "system",
            )
            .order_by(MemoryEntry.seq.asc())
            .limit(threshold // 2)
        )
        old_entries = res.scalars().all()
        if not old_entries:
            return None

        batch = "\n".join(f"[{e.role}] {e.content}" for e in old_entries)
        summary = await self._summarize(batch)
        if not summary:
            return None

        # 写一条 system 摘要条目（高重要性，作为长期记忆）
        seq = await self._next_seq(session, user_id, agent_name)
        summary_entry = MemoryEntry(
            user_id=user_id,
            agent_name=agent_name,
            role="system",
            content=f"【长期记忆摘要】{summary}",
            keywords=extract_keywords(summary),
            importance=5.0,
            compressed=True,  # 摘要本身不再被二次压缩
            seq=seq,
        )
        session.add(summary_entry)
        await session.flush()

        # 标记旧条目为已压缩
        for e in old_entries:
            e.compressed = True

        commit = MemoryCommit(
            user_id=user_id,
            agent_name=agent_name,
            commit_hash=_make_hash(user_id, agent_name),
            message=f"auto-compress {len(old_entries)} entries",
            parent_hash=None,
            message_count=len(old_entries),
            commit_type="compress",
            summary=summary[:500],
        )
        session.add(commit)
        await session.flush()
        summary_entry.commit_id = commit.id

        # 更新 HEAD
        await self._ensure_branch(session, user_id, agent_name, commit.commit_hash)
        return commit.to_dict()

    async def _summarize(self, text: str) -> Optional[str]:
        """调用 LLM 对文本做无损摘要（失败返回 None，不影响主流程）。"""
        try:
            if not llm_manager.is_configured():
                return None
            prompt = [
                {
                    "role": "system",
                    "content": "你是记忆压缩器。请将下面的对话/任务记录压缩为简洁、高信息密度的要点摘要，"
                    "保留关键决策、事实、结论与待办，使用中文，不超过 300 字。",
                },
                {"role": "user", "content": text},
            ]
            return await llm_manager.chat(prompt, max_tokens=600)
        except Exception as e:
            logger.warning(f"记忆压缩摘要失败（已跳过）: {e}")
            return None

    async def compress_now(self, user_id: int, agent_name: str) -> Optional[dict]:
        """手动触发压缩。"""
        async with create_session() as session:
            return await self._maybe_compress(session, user_id, agent_name, threshold=1)

    # ── 检索：关键词/记忆图谱 ──────────────────────────────

    async def recall(
        self,
        user_id: int,
        agent_name: str,
        query: str,
        k: int = 6,
        include_compressed: bool = True,
    ) -> list[dict]:
        """根据 query 关键词检索相关记忆条目（记忆图谱检索）。"""
        q_kw = set(extract_keywords(query))
        if not q_kw:
            return []

        async with create_session() as session:
            stmt = select(MemoryEntry).where(
                MemoryEntry.user_id == user_id,
                MemoryEntry.agent_name == agent_name,
            )
            if not include_compressed:
                stmt = stmt.where(MemoryEntry.compressed.is_(False))
            stmt = stmt.order_by(MemoryEntry.seq.desc())
            res = await session.execute(stmt)
            entries = res.scalars().all()

        scored = []
        for e in entries:
            e_kw = set(e.keywords or [])
            overlap = q_kw & e_kw
            if not overlap:
                continue
            score = len(overlap) * (1 + e.importance / 5.0)
            scored.append((score, e))

        scored.sort(key=lambda x: -x[0])
        return [e.to_dict() for _, e in scored[:k]]

    # ── 上下文构建 ─────────────────────────────────────────

    async def build_context(
        self,
        user_id: int,
        agent_name: str,
        query: Optional[str] = None,
        memory_strength: float = 3.0,
        token_budget: int = 3000,
    ) -> list[dict]:
        """
        构建发送给 LLM 的记忆上下文。

        组成：压缩摘要（长期记忆）+ 近期窗口（按记忆强度）+ 相关性检索（长记忆）。
        受 token_budget 约束。
        """
        window = int(4 + memory_strength * 4)  # 4..24 条近期消息

        async with create_session() as session:
            # 长期记忆摘要（compressed 的 system 条目）
            res = await session.execute(
                select(MemoryEntry)
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.agent_name == agent_name,
                    MemoryEntry.role == "system",
                    MemoryEntry.compressed.is_(True),
                )
                .order_by(MemoryEntry.seq.desc())
                .limit(3)
            )
            summaries = res.scalars().all()

            # 近期窗口（未压缩）
            res = await session.execute(
                select(MemoryEntry)
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.agent_name == agent_name,
                    MemoryEntry.compressed.is_(False),
                )
                .order_by(MemoryEntry.seq.desc())
                .limit(window)
            )
            recent = list(reversed(res.scalars().all()))

        context: list[dict] = []

        # 1. 长期记忆摘要
        for s in summaries:
            context.append({"role": "system", "content": s.content})

        # 2. 相关性检索（长记忆，仅在给定 query 时）
        if query:
            recalled = await self.recall(
                user_id, agent_name, query, k=max(3, window // 3),
                include_compressed=False,
            )
            for r in recalled:
                context.append({"role": r["role"], "content": r["content"]})

        # 3. 近期窗口
        for e in recent:
            context.append({"role": e.role, "content": e.content})

        # 4. token 预算裁剪（保留 system 摘要，优先裁剪最旧）
        pruned = [m for m in context if m["role"] == "system"]
        rest = [m for m in context if m["role"] != "system"]
        used = sum(_estimate_tokens(m["content"]) for m in pruned)
        for m in rest:
            t = _estimate_tokens(m["content"])
            if used + t <= token_budget:
                pruned.append(m)
                used += t
        return pruned

    # ── 版本控制：列表 / 详情 / 回退 ────────────────────────

    async def list_commits(
        self, user_id: int, agent_name: str, limit: int = 50
    ) -> list[dict]:
        async with create_session() as session:
            res = await session.execute(
                select(MemoryCommit)
                .where(
                    MemoryCommit.user_id == user_id,
                    MemoryCommit.agent_name == agent_name,
                )
                .order_by(desc(MemoryCommit.created_at))
                .limit(limit)
            )
            commits = res.scalars().all()
        return [c.to_dict() for c in commits]

    async def get_commit(self, user_id: int, commit_hash: str) -> Optional[dict]:
        async with create_session() as session:
            res = await session.execute(
                select(MemoryCommit).where(
                    MemoryCommit.commit_hash == commit_hash,
                    MemoryCommit.user_id == user_id,
                )
            )
            commit = res.scalar_one_or_none()
            if not commit:
                return None
            res = await session.execute(
                select(MemorySnapshot).where(MemorySnapshot.commit_id == commit.id)
            )
            snap = res.scalar_one_or_none()
            data = commit.to_dict()
            data["snapshot"] = snap.data if snap else None
            return data

    async def rollback(self, user_id: int, agent_name: str, commit_hash: str) -> dict:
        """
        git reset 式回退：将 HEAD 指向目标 commit，
        并删除该 commit 之后的所有 commit 与未压缩条目（保留历史可见性通过 commit 记录）。
        """
        async with create_session() as session:
            res = await session.execute(
                select(MemoryCommit).where(
                    MemoryCommit.commit_hash == commit_hash,
                    MemoryCommit.user_id == user_id,
                    MemoryCommit.agent_name == agent_name,
                )
            )
            target = res.scalar_one_or_none()
            if not target:
                raise ValueError(f"commit {commit_hash} 不存在")

            # 删除目标之后的 commit
            res = await session.execute(
                select(MemoryCommit)
                .where(
                    MemoryCommit.user_id == user_id,
                    MemoryCommit.agent_name == agent_name,
                    MemoryCommit.created_at > target.created_at,
                )
                .order_by(MemoryCommit.created_at.asc())
            )
            later = res.scalars().all()
            later_ids = [c.id for c in later]

            if later_ids:
                # 删除这些 commit 关联但未被压缩的条目（保留 compressed 摘要）
                await session.execute(
                    MemoryEntry.__table__.delete().where(
                        MemoryEntry.commit_id.in_(later_ids),
                        MemoryEntry.compressed.is_(False),
                    )
                )
                for c in later:
                    await session.delete(c)

            # 更新 HEAD
            branch = await self._get_branch(session, user_id, agent_name)
            if branch:
                branch.head_hash = target.commit_hash
                branch.updated_at = datetime.utcnow()

            # 生成一个 rollback 标记 commit（便于审计）
            rb = MemoryCommit(
                user_id=user_id,
                agent_name=agent_name,
                commit_hash=_make_hash(user_id, agent_name),
                message=f"rollback to {commit_hash}",
                parent_hash=target.commit_hash,
                message_count=0,
                commit_type="rollback",
            )
            session.add(rb)
            await session.flush()
            if branch:
                branch.head_hash = rb.commit_hash

            await session.commit()
            return rb.to_dict()

    async def get_stats(self, user_id: int, agent_name: str) -> dict:
        """记忆统计信息。"""
        async with create_session() as session:
            res = await session.execute(
                select(
                    func.count(MemoryEntry.id),
                    func.sum(func.cast(MemoryEntry.compressed, Integer)),
                ).where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.agent_name == agent_name,
                )
            )
            total, compressed = res.first()
            branch = await self._get_branch(session, user_id, agent_name)
            return {
                "agent_name": agent_name,
                "total_entries": total or 0,
                "compressed_entries": int(compressed or 0),
                "head_hash": branch.head_hash if branch else None,
            }


# 全局单例
memory_manager = MemoryManager()
