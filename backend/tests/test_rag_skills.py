# -*- coding: utf-8 -*-
"""RAG 混合检索 + 技能沙箱执行 + 工具门控 的单元测试（无需数据库/网络）。

运行: cd backend && python -m pytest -q
"""

import asyncio
import json
import re
import sys
from pathlib import Path

# 确保 backend 在 sys.path，便于 import app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.tokenize import tokenize as _tokenize
from app.core.rag import (
    _chunk_text,
    _record_text,
    _bm25_scores,
    _normalize,
    _hybrid_fusion,
)
from app.core.embeddings import cosine, EmbeddingError, embed_query
from app.core.tools import should_enable_code_tools, resolve_code_tools_enabled
from app.core import skill_runtime as sr


# ══════════════════════════════════════════════════════════════════
# 测试假 DB（模拟 SQLAlchemy execute().scalars().all() / .scalar_one_or_none()）
# ══════════════════════════════════════════════════════════════════

def _install_fake_db(monkeypatch, row):
    import app.database as dbmod

    class FakeResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def all(self):
            return [self._row] if self._row is not None else []

        def scalar_one_or_none(self):
            return self._row

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def execute(self, *a, **k):
            return FakeResult(row)

    class FakeCtx:
        async def __aenter__(self):
            return FakeSession()

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(dbmod, "create_session", lambda: FakeCtx())


# ══════════════════════════════════════════════════════════════════
# RAG 切片
# ══════════════════════════════════════════════════════════════════

def test_chunk_text_short_is_single_chunk():
    assert _chunk_text("hello world") == ["hello world"]


def test_chunk_text_long_has_overlap_and_reconstructs():
    text = "x" * 2000
    chunks = _chunk_text(text, max_chars=700, overlap=120)
    assert len(chunks) >= 2
    assert all(len(c) <= 700 for c in chunks)
    # 重叠区域去重后可无损还原原文
    recon = chunks[0]
    for c in chunks[1:]:
        recon += c[120:]
    assert recon == text


def test_record_text_joins_fields():
    class Rec:
        data = {"title": "苹果", "price": 9, "note": "新鲜"}
    assert _record_text(Rec()) == "苹果 9 新鲜"


# ══════════════════════════════════════════════════════════════════
# BM25 / 归一化 / 融合
# ══════════════════════════════════════════════════════════════════

def test_bm25_ranks_relevant_doc_higher():
    docs = [_tokenize("苹果 手机 价格 评测"), _tokenize("香蕉 水果 营养 热量")]
    q = _tokenize("苹果 手机")
    scores = _bm25_scores(docs, q)
    assert scores[0] > scores[1]


def test_normalize_minmax_and_constant():
    assert _normalize([0, 5, 10]) == [0.0, 0.5, 1.0]
    assert _normalize([3, 3, 3]) == [1.0, 1.0, 1.0]


def test_hybrid_fusion_weighting():
    fused = _hybrid_fusion([0.0, 1.0], [1.0, 0.0], alpha=0.7)
    assert abs(fused[0] - 0.7) < 1e-9   # 0.7*vec + 0.3*bm25
    assert abs(fused[1] - 0.3) < 1e-9


# ══════════════════════════════════════════════════════════════════
# 向量 / embedding 降级
# ══════════════════════════════════════════════════════════════════

def test_cosine_basics():
    assert abs(cosine([1.0, 0.0], [1.0, 0.0]) - 1.0) < 1e-9
    assert abs(cosine([1.0, 0.0], [0.0, 1.0])) < 1e-9
    assert cosine([], []) == 0.0
    assert cosine([1, 2], [1, 2, 3]) == 0.0  # 维度不一致 -> 0


def test_embedding_disabled_raises(monkeypatch):
    # 无 llm_config.json（enabled=False）时应抛 EmbeddingError，调用方回退 BM25
    import app.core.llm as llm_mod
    monkeypatch.setattr(llm_mod, "load_llm_config", lambda: {})
    try:
        asyncio.run(embed_query("任意查询"))
        assert False, "应当抛出 EmbeddingError"
    except EmbeddingError:
        pass


# ══════════════════════════════════════════════════════════════════
# 工具门控
# ══════════════════════════════════════════════════════════════════

def test_should_enable_code_tools_name_based():
    assert should_enable_code_tools(["coding"]) is True
    assert should_enable_code_tools(["run-python"]) is True
    assert should_enable_code_tools(["some-behavior-skill"]) is False
    assert should_enable_code_tools([]) is False


def test_resolve_code_tools_enabled_by_config_code(monkeypatch):
    """健壮门控：即便技能名不匹配 EXECUTABLE_SKILLS，只要它是代码技能(config.code) 也解锁。"""

    class FakeRowCode:
        config = {"code": "def skill_main(ctx):\n    return 1"}

    _install_fake_db(monkeypatch, FakeRowCode())
    # 名字完全不像预设，但 config.code 存在 -> 仍应解锁
    assert asyncio.run(resolve_code_tools_enabled(["my-custom-github-skill"], 1)) is True

    _install_fake_db(monkeypatch, None)  # 没有该技能
    assert asyncio.run(resolve_code_tools_enabled(["unknown"], 1)) is False


# ══════════════════════════════════════════════════════════════════
# 技能沙箱执行契约
# ══════════════════════════════════════════════════════════════════

def test_skill_runtime_executes_and_returns_result(monkeypatch):
    """execute_skill 应真实调用沙箱、读取技能 skill_main 的返回值作为结构化结果。"""
    class FakeRow:
        config = {"code": "def skill_main(ctx):\n    return 42"}
    _install_fake_db(monkeypatch, FakeRow())

    # 用假 run_code 代替真实子进程：从 runner 中提取 RESULT_PATH 并写入结果文件
    def fake_run_code(*, code="", language=None, user_id=None, args=None, filename=None, timeout=None):
        m = re.search(r'RESULT_PATH = r"(.*?)"', code)
        if m:
            Path(m.group(1)).write_text(json.dumps({"result": 42}), encoding="utf-8")
        return {"stdout": "fake-stdout", "stderr": "", "exit_code": 0, "timed_out": False}

    monkeypatch.setattr(sr, "run_code", fake_run_code)

    res = asyncio.run(sr.execute_skill(999999, "test_skill", {"x": 1}))
    assert res["ok"] is True
    assert res["result"] == 42
    assert res["stdout"] == "fake-stdout"
    assert res["skill"] == "test_skill"


def test_skill_runtime_unknown_skill_returns_error(monkeypatch):
    _install_fake_db(monkeypatch, None)  # scalar_one_or_none -> None
    res = asyncio.run(sr.execute_skill(999999, "missing", None))
    assert res["ok"] is False
    assert "不存在" in res["error"]


def test_skill_runtime_argv_and_safe_name():
    assert sr._args_to_argv(None) == []
    assert sr._args_to_argv(["a", "b"]) == ["a", "b"]
    assert sr._args_to_argv({"k": "v"}) == ["--k", "v"]
    assert sr._safe_name("My Skill!") == "My_Skill_"
