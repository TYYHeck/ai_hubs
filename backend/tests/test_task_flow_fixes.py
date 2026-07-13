# -*- coding: utf-8 -*-
"""
任务流程修复回归测试（对应四个根因）

根因 #2: run_code 拦截「把执行命令当代码传入」并友好提示改用 run_terminal
根因 #3: 串行接力（_task_tool_errors 累积 + 工作区清单注入，由 run_sequential 使用）
根因 #4: 产出验证（_verify_deliverable / _infer_expected_exts），缺失期望产物标记 needs_review
根因 #1: write_file 空内容防护（在 sandbox 内，本测试通过 run_code 友好提示间接覆盖逻辑位置）

运行: 在 backend/ 目录 `python -m unittest tests.test_task_flow_fixes -v`
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

# 确保 backend 在 sys.path，便于 import app.*
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.deliverable import _infer_expected_exts, _verify_deliverable


class _FakeTask:
    """最小化 Task 替身，仅暴露 title / description。"""
    def __init__(self, title="", description=""):
        self.title = title
        self.description = description


class DeliverableVerifyTests(unittest.TestCase):
    """根因 #4：产出验证。"""

    def test_ppt_keyword_infers_pptx(self):
        self.assertEqual(_infer_expected_exts(_FakeTask(title="生成精美的PPT")), {".pptx"})
        self.assertEqual(_infer_expected_exts(_FakeTask(description="做一份演示幻灯片")), {".pptx"})

    def test_report_keyword_infers_docx(self):
        self.assertEqual(_infer_expected_exts(_FakeTask(title="写一份技术报告")), {".docx"})

    def test_plain_text_task_infers_nothing(self):
        self.assertEqual(_infer_expected_exts(_FakeTask(title="翻译这段话", description="hello")), set())

    def test_ppt_produced_ok(self):
        task = _FakeTask(title="生成关于Agent的PPT")
        outputs = [{"name": "a.pptx", "ext": ".pptx", "size": 1234}]
        ok, reason = _verify_deliverable(task, outputs)
        self.assertTrue(ok, reason)
        self.assertEqual(reason, "")

    def test_ppt_missing_marks_failed(self):
        task = _FakeTask(title="生成关于Agent的PPT")
        # 只有一堆空 .md 文件，典型的「假完成」现场
        outputs = [
            {"name": "document_1.md", "ext": ".md", "size": 0},
            {"name": "document_2.md", "ext": ".md", "size": 0},
        ]
        ok, reason = _verify_deliverable(task, outputs)
        self.assertFalse(ok)
        self.assertIn(".pptx", reason)

    def test_ppt_with_extra_empty_md_still_ok(self):
        task = _FakeTask(title="生成PPT")
        outputs = [
            {"name": "deck.pptx", "ext": ".pptx", "size": 999},
            {"name": "note.md", "ext": ".md", "size": 0},  # 有空文件但期望产物已存在，应通过
        ]
        ok, _ = _verify_deliverable(task, outputs)
        self.assertTrue(ok)

    def test_text_task_no_output_is_ok(self):
        # 对话/文本类任务不产生文件属正常
        task = _FakeTask(title="翻译这段话")
        ok, _ = _verify_deliverable(task, [])
        self.assertTrue(ok)

    def test_empty_file_bug_detected_in_text_task(self):
        # 即便无法推断产物类型，0 字节空文件也应判失败
        task = _FakeTask(title="整理一下思路")
        outputs = [{"name": "out.md", "ext": ".md", "size": 0}]
        ok, reason = _verify_deliverable(task, outputs)
        self.assertFalse(ok)
        self.assertIn("0 字节", reason)


class RunCodeShellGuardTests(unittest.TestCase):
    """根因 #2：run_code 拦截「执行命令当代码」。"""

    def _import_sandbox(self):
        from app.core import sandbox
        return sandbox

    def test_detect_shell_command(self):
        sandbox = self._import_sandbox()
        self.assertTrue(sandbox._looks_like_shell_command("python3 xxx.py", "python"))
        self.assertTrue(sandbox._looks_like_shell_command("python xxx.py\nprint(1)", "python"))
        self.assertTrue(sandbox._looks_like_shell_command("pip install x", "python"))
        self.assertTrue(sandbox._looks_like_shell_command("node run.js", "javascript"))

    def test_real_code_not_flagged(self):
        sandbox = self._import_sandbox()
        self.assertFalse(sandbox._looks_like_shell_command("import os\nprint(os.getcwd())", "python"))
        self.assertFalse(sandbox._looks_like_shell_command("def f():\n    return 1", "python"))

    def test_bash_language_not_intercepted(self):
        sandbox = self._import_sandbox()
        # bash 下命令式写法是合法的，不应拦截
        self.assertFalse(sandbox._looks_like_shell_command("echo hello", "bash"))
        self.assertFalse(sandbox._looks_like_shell_command("python3 xxx.py", "bash"))

    def test_run_code_returns_hint_without_writing(self):
        sandbox = self._import_sandbox()
        # 用一个临时 user_id，提前记录工作区文件数
        import time
        user_id = 9_000_000 + int(time.time()) % 100000
        ws = sandbox._workspace_root(user_id)
        before = set(ws.glob("_agent_*")) if ws.exists() else set()

        res = sandbox.run_code("python3 /root/x/generate_ppt.py", "python", user_id=user_id)

        self.assertEqual(res.get("hint"), "use_run_terminal")
        self.assertEqual(res.get("exit_code"), -1)
        self.assertIn("run_terminal", res.get("stderr", ""))
        # 友好提示应在写入文件前返回，不应在工作区留下临时脚本
        after = set(ws.glob("_agent_*")) if ws.exists() else set()
        self.assertEqual(before, after, "run_code 不应在友好提示路径下写入临时文件")


if __name__ == "__main__":
    unittest.main(verbosity=2)
