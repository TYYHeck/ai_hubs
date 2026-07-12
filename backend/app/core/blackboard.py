# -*- coding: utf-8 -*-
"""
Blackboard — Agent 间结构化共享状态（议题 #1）

替代原"纯文本拼接"的协作通道，提供：
- public 区：所有参与 Agent 可读写（接力产物、最终决策）
- private 区：每 Agent 独立草稿（对应 §2 的 private 区）
- 基于能力的访问控制（capability-based）：
  * 读权限 ← 是否参与（participation）
  * 写权限 ← 是否公共编写（public_write intent）
- 拓扑校验（MODE_TOPOLOGIES）：不同执行模式声明每槽位的读范围/写权限。

生命周期：每个 task_id 一份独立 Blackboard，任务结束由 Orchestrator 清理。
与 §4 asyncio 同一事件循环天然无锁并发（单线程协同）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger("ai_hubs.blackboard")

# 模式拓扑：每槽位声明 read 范围 + 是否可写 public
# reads: "public" | "public+prev" | "all_private"
MODE_TOPOLOGIES: dict[str, dict[str, dict[str, str | bool]]] = {
    "pipeline":     {"stage": {"reads": "public+prev", "can_write_public": True}},
    "sequential":   {"stage": {"reads": "public+prev", "can_write_public": True}},
    "parallel":     {"worker": {"reads": "public", "can_write_public": False},
                     "synthesizer": {"reads": "all_private", "can_write_public": True}},
    "hierarchical": {"expert": {"reads": "public", "can_write_public": False},
                     "manager": {"reads": "all_private", "can_write_public": True},
                     "director": {"reads": "all_private", "can_write_public": True}},
    "debate":       {"speaker": {"reads": "public", "can_write_public": True}},
    "vote":         {"voter": {"reads": "public", "can_write_public": True}},
    "swarm":        {"member": {"reads": "all_private", "can_write_public": True}},
    "peer_review":  {"reviewer": {"reads": "public", "can_write_public": True}},
    "round_table":  {"participant": {"reads": "public", "can_write_public": True}},
}


@dataclass
class Blackboard:
    task_id: str
    mode: str = "custom"
    public: dict[str, Any] = field(default_factory=dict)
    private: dict[str, dict[str, Any]] = field(default_factory=dict)  # agent -> {key: value}
    participants: set[str] = field(default_factory=set)
    _order: list[str] = field(default_factory=list)  # 写入 public 的顺序（用于 prev 链）

    # ── 写（带拓扑校验）──
    def write_public(self, agent: str, key: str, value: Any, role: str = "stage") -> None:
        if not self._can_write_public(agent, role):
            logger.warning(f"[{self.task_id}] Agent {agent} 无 public 写权限（role={role}），降级为 private")
            self.write_private(agent, key, value)
            return
        self.public[key] = value
        self._order.append(key)

    def write_private(self, agent: str, key: str, value: Any) -> None:
        self.private.setdefault(agent, {})[key] = value

    # ── 读（带拓扑校验）──
    def read_public(self, agent: str | None = None) -> dict:
        return dict(self.public)

    def read_prev(self, agent: str | None = None) -> dict:
        """读取 public 区中「上一步」产物（pipeline/sequential 用）。"""
        if not self._order:
            return {}
        prev_key = self._order[-1]
        return {prev_key: self.public.get(prev_key)}

    def read_all_private(self) -> dict[str, dict[str, Any]]:
        return {a: dict(v) for a, v in self.private.items()}

    def read_private(self, agent: str, key: str) -> Any:
        return self.private.get(agent, {}).get(key)

    def join_participant(self, agent: str) -> None:
        self.participants.add(agent)

    # ── 拓扑校验 ──
    def _topo(self, role: str) -> dict:
        return MODE_TOPOLOGIES.get(self.mode, {}).get(role, {"reads": "public", "can_write_public": True})

    def _can_write_public(self, agent: str, role: str) -> bool:
        topo = self._topo(role)
        if not topo.get("can_write_public", True):
            return False
        # 写 public 要求「参与」（能力访问控制：未参与的 Agent 不应写公共区）
        return agent in self.participants or len(self.participants) == 0

    def finalize(self) -> dict:
        """汇总产出：优先 public 区，附 participants 清单。"""
        return {
            "public": dict(self.public),
            "participants": sorted(self.participants),
            "order": list(self._order),
        }


# 模块级注册表：task_id -> Blackboard（任务级生命周期）
_BOARDS: dict[str, Blackboard] = {}


def get_blackboard(task_id: str, mode: str = "custom") -> Blackboard:
    board = _BOARDS.get(task_id)
    if board is None:
        board = Blackboard(task_id=task_id, mode=mode)
        _BOARDS[task_id] = board
    if mode != "custom":
        board.mode = mode
    return board


def drop_blackboard(task_id: str) -> None:
    _BOARDS.pop(task_id, None)


def active_board_count() -> int:
    return len(_BOARDS)
