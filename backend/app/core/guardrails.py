# -*- coding: utf-8 -*-
"""
AI 内容级护栏（L2 内容审核 + L3 多 Agent 注入防护）

均为规则轻量实现，无需外部 API 调用，可通过开关配置。
- L2_CONTENT_GUARDRAIL：对输入/输出做敏感/违规内容扫描，默认 warn（不阻断，避免误伤）。
- L3_INJECTION_GUARDRAIL：对写入 Blackboard 的 Agent 产出做提示注入扫描，
  命中则清洗（剥离注入指令片段）或标记 warn，防止一个 Agent 劫持后续 Agent。

设计原则（呼应 multi_agent_architecture.md §10 / §16）：
- 默认不阻断，只标记；仅在「严格模式」下允许 hard_stop。
- 规则保守，避免误伤正常内容（密钥/邮箱/手机/路径清洗由 memory.py 的 _desensitize 负责）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ── 配置开关（可由 settings 覆盖）──
CONTENT_GUARDRAIL_ENABLED = True     # L2 总开关
INJECTION_GUARDRAIL_ENABLED = True   # L3 总开关
STRICT_GUARDRAIL = False             # True 时命中严重项直接阻断（hard_stop）

# 严重级别
SEV_INFO = "info"
SEV_WARN = "warn"
SEV_BLOCK = "block"


@dataclass
class Verdict:
    """护栏判定结果"""
    status: str = SEV_INFO          # info | warn | block
    reasons: list[str] | None = None
    sanitized: str | None = None    # 清洗后文本（命中时提供）

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "reasons": self.reasons or [],
            "sanitized": self.sanitized,
        }


# L3 提示注入特征（中英文常见 jailbreak / 注入指令片段）
_INJECTION_PATTERNS: list[tuple[str, str]] = [
    (r"忽略(以上|之前|前面|上述).{0,6}(指令|提示|要求|设定|prompt|system)", "忽略前缀指令"),
    (r"ignore (the )?(previous|above|prior|following) (instructions|prompt|system|rules)", "ignore-previous-instructions"),
    (r"你(现在)?(是|变成|扮演).{0,10}(新助手|新的AI|另一个|开发者|管理员|root)", "角色劫持"),
    (r"you are now (a|an|the) (new|different|developer|admin|root|uncensored)", "role-hijack"),
    (r"disregard (your |the )?(previous|above|system|prior)", "disregard-instructions"),
    (r"system prompt", "system-prompt-leak"),
    (r"developer mode", "developer-mode"),
    (r"(解除|去掉|关闭).{0,4}(限制|约束|审查|过滤|安全)", "解除限制"),
    (r"jailbreak|越狱", "jailbreak"),
    (r"DAN|do anything now", "dan-mode"),
]

_INJECTION_RE = [(re.compile(p, re.IGNORECASE | re.DOTALL), label) for p, label in _INJECTION_PATTERNS]

# L2 内容风险特征（政治/违禁/仇恨/自残等敏感方向，保守匹配）
_CONTENT_RISK_PATTERNS: list[tuple[str, str]] = [
    (r"(制造|合成|提取).{0,8}(炸药|毒品|毒品|毒药|冰毒|枪支|炸弹)", "违禁品制作"),
    (r"(如何|怎样|教我).{0,10}(自杀|自残|轻生)", "自残引导"),
    (r"(种族|民族|地域).{0,4}(仇恨|灭绝|歧视)", "仇恨言论"),
]

_CONTENT_RISK_RE = [(re.compile(p, re.IGNORECASE) , label) for p, label in _CONTENT_RISK_PATTERNS]


def scan_injection(text: str) -> Verdict:
    """L3：扫描文本中的提示注入特征（用于 Blackboard 写入前）。"""
    if not INJECTION_GUARDRAIL_ENABLED or not text:
        return Verdict(SEV_INFO)
    hits: list[str] = []
    redacted = text
    for pat, label in _INJECTION_RE:
        m = pat.search(text)
        if m:
            hits.append(label)
            # 清洗：用占位符替换整段注入片段（最多整句）
            start = max(0, m.start() - 20)
            end = min(len(redacted), m.end() + 20)
            redacted = redacted[:start] + "〔已过滤：疑似提示注入指令〕" + redacted[end:]
    if hits:
        if STRICT_GUARDRAIL:
            return Verdict(SEV_BLOCK, hits, redacted)
        return Verdict(SEV_WARN, hits, redacted)
    return Verdict(SEV_INFO)


def scan_content(text: str) -> Verdict:
    """L2：扫描输入/输出中的敏感/违规内容。默认 warn，不阻断。"""
    if not CONTENT_GUARDRAIL_ENABLED or not text:
        return Verdict(SEV_INFO)
    hits: list[str] = []
    for pat, label in _CONTENT_RISK_RE:
        if pat.search(text):
            hits.append(label)
    if hits:
        # 内容风险始终标记 warn；极端情况下可配置 hard_stop，但默认不阻断以免误伤正常创作
        return Verdict(SEV_WARN, hits, text)
    return Verdict(SEV_INFO)


def guard_output(text: str) -> tuple[str, Verdict]:
    """对 Agent 最终产出做组合护栏：先注入清洗再内容标记，返回 (清洗后文本, 判定)。"""
    inj = scan_injection(text)
    cleaned = inj.sanitized if inj.sanitized is not None else text
    if inj.status == SEV_BLOCK and STRICT_GUARDRAIL:
        return cleaned, inj
    risk = scan_content(cleaned)
    if risk.status == SEV_WARN and inj.status != SEV_WARN:
        return cleaned, risk
    if inj.status == SEV_WARN:
        return cleaned, inj
    return cleaned, risk
