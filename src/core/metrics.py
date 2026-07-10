# -*- coding: utf-8 -*-
"""
Metrics 监控 —— Token 统计 + 延迟追踪

用法:
    with MetricsTracker(agent) as tracker:
        agent.run("任务")
    print(tracker.summary())
"""

from __future__ import annotations
import time
import logging
from dataclasses import dataclass, field
from datetime import datetime

logger = logging.getLogger("ai_hubs.metrics")


@dataclass
class TurnMetrics:
    """单轮对话指标"""
    start_time: float = 0.0
    end_time: float = 0.0
    llm_call_count: int = 0
    tool_call_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    llm_latency_ms: float = 0.0

    @property
    def total_time_ms(self) -> float:
        return (self.end_time - self.start_time) * 1000

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens


@dataclass
class MetricsCollector:
    """累积指标收集器"""

    turns: list[TurnMetrics] = field(default_factory=list)
    session_start: datetime = field(default_factory=datetime.now)

    @property
    def total_turns(self) -> int:
        return len(self.turns)

    @property
    def total_llm_calls(self) -> int:
        return sum(t.llm_call_count for t in self.turns)

    @property
    def total_tools_called(self) -> int:
        return sum(t.tool_call_count for t in self.turns)

    @property
    def total_input_tokens(self) -> int:
        return sum(t.total_input_tokens for t in self.turns)

    @property
    def total_output_tokens(self) -> int:
        return sum(t.total_output_tokens for t in self.turns)

    @property
    def avg_latency_ms(self) -> float:
        if not self.turns:
            return 0.0
        return sum(t.total_time_ms for t in self.turns) / len(self.turns)

    def start_turn(self) -> TurnMetrics:
        m = TurnMetrics(start_time=time.time())
        return m

    def end_turn(self, m: TurnMetrics):
        m.end_time = time.time()
        self.turns.append(m)

    def summary(self) -> dict:
        """生成汇总报告"""
        return {
            "session_duration_s": round(
                (datetime.now() - self.session_start).total_seconds(), 1
            ),
            "total_turns": self.total_turns,
            "total_llm_calls": self.total_llm_calls,
            "total_tools_called": self.total_tools_called,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "avg_latency_ms": round(self.avg_latency_ms, 1),
        }

    def summary_text(self) -> str:
        s = self.summary()
        return (
            f"会话 {s['session_duration_s']}s | "
            f"{s['total_turns']} 轮 | "
            f"LLM 调用 {s['total_llm_calls']} 次 | "
            f"工具 {s['total_tools_called']} 次 | "
            f"Token: {s['total_input_tokens']}入/{s['total_output_tokens']}出 | "
            f"均延迟 {s['avg_latency_ms']}ms"
        )


def estimate_tokens(text: str) -> int:
    """
    粗略 token 估算（tiktoken 不可用时的回退方案）
    中文: ~1.5 字/token, 英文: ~4 字/token
    """
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    other_chars = len(text) - chinese_chars
    return int(chinese_chars / 1.5 + other_chars / 4)


def count_tokens(text: str, model: str = "gpt-4o") -> int:
    """精确 token 计数（优先用 tiktoken）"""
    try:
        import tiktoken
        try:
            enc = tiktoken.encoding_for_model(model)
        except KeyError:
            enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except ImportError:
        return estimate_tokens(text)
