# -*- coding: utf-8 -*-
"""
统一分词器 — 中文二元(bigram) + 英文单词

为什么用 bigram：
  中文没有空格，贪婪式整段匹配（如「如何读取文件」整体作为一个 token）会导致
  查询「读取文件」与文档 token 边界不一致、无法重叠匹配。
  二元分词把「如何读取文件」拆为「如何/何读/读取/取文/文件」，
  查询「读取文件」→「读取/取文/文件」，二者有大量重叠，检索召回稳定可靠。

记忆系统（关键词索引）与 RAG（BM25）共用本模块，确保一致性。
"""

from __future__ import annotations

import re
from collections import Counter

_CJK_RUN = re.compile(r"[一-鿿]+")
_ENGLISH = re.compile(r"[a-zA-Z][a-zA-Z0-9_]*")


def tokenize(text: str) -> list[str]:
    """分词：中文二元 + 英文单词（小写）。"""
    if not text:
        return []

    tokens: list[str] = []
    for run in _CJK_RUN.findall(text):
        if len(run) == 1:
            tokens.append(run)
        else:
            # 二元滑动窗口，并用首尾单字兜底
            for i in range(len(run) - 1):
                tokens.append(run[i : i + 2])
            tokens.append(run[0])
            tokens.append(run[-1])

    tokens += [w.lower() for w in _ENGLISH.findall(text)]
    return tokens


def keywords(text: str, top_k: int = 12) -> list[str]:
    """提取关键词（去重、按词频排序），用于记忆条目索引。"""
    toks = tokenize(text)
    if not toks:
        return []
    counter = Counter(toks)
    return [w for w, _ in counter.most_common(top_k)]
