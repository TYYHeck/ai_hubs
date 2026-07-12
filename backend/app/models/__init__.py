# -*- coding: utf-8 -*-
"""ORM 模型导出 — 导入所有模型以确保注册到 Base.metadata"""

from .base import Base
from .user import User, VerificationCode
from .agent import Agent
from .task import Task, TaskEvent
from .skill import Skill
from .dataset import Dataset, DatasetRecord
from .memory import MemoryBranch, MemoryCommit, MemoryEntry, MemorySnapshot
from .conversation import Conversation, Message
from .attachment import Attachment
from .system import SystemLog, KnowledgeSource
from .knowledge import KnowledgeBase, KnowledgeDoc

__all__ = [
    "Base",
    "User", "VerificationCode",
    "Agent",
    "Task", "TaskEvent",
    "Skill",
    "Dataset", "DatasetRecord",
    "MemoryBranch", "MemoryCommit", "MemoryEntry", "MemorySnapshot",
    "Conversation", "Message",
    "Attachment",
    "SystemLog", "KnowledgeSource",
    "KnowledgeBase", "KnowledgeDoc",
]
