# -*- coding: utf-8 -*-
"""跨平台命令行输入 —— 支持上下箭头历史回溯与 Tab 补全猜测指令。

- Windows (msvcrt)：自实现行编辑器，支持方向键、退格、Tab 提示
- 其他平台 (readline)：使用 GNU readline 历史 + Tab 补全
"""

from __future__ import annotations

import sys


def read_line(prompt: str, history: list, completer=None) -> str:
    """读取一行输入。

    history: 历史命令列表（会被就地更新，追加本次输入）
    completer: 可选的可调用对象，接收当前行返回补全候选列表（用于 Tab 猜测指令）
    """
    if sys.platform == "win32":
        return _win_input(prompt, history, completer)
    return _unix_input(prompt, history, completer)


# ============================================================
# Windows 实现（msvcrt）
# ============================================================

def _win_redraw(prompt: str, buf: list, pos: int):
    line = "".join(buf)
    sys.stdout.write("\r" + prompt + line)
    sys.stdout.write("\x1b[K")  # 清除光标到行尾
    if len(line) - pos > 0:
        sys.stdout.write("\x1b[%dD" % (len(line) - pos))
    sys.stdout.flush()


def _win_input(prompt: str, history: list, completer) -> str:
    import msvcrt

    hist = list(history)
    hi = len(hist)  # 历史指针（=len 表示当前未提交的草稿）
    buf: list = []
    pos = 0

    sys.stdout.write(prompt)
    sys.stdout.flush()

    while True:
        ch = msvcrt.getwch()

        if ch in ("\r", "\n"):
            sys.stdout.write("\n")
            return "".join(buf)

        if ch == "\x03":  # Ctrl-C
            raise KeyboardInterrupt

        if ch == "\x08":  # Backspace
            if pos > 0:
                buf.pop(pos - 1)
                pos -= 1
                _win_redraw(prompt, buf, pos)
            continue

        if ch == "\t":  # Tab 补全提示
            if completer:
                line = "".join(buf)
                cands = completer(line)
                if cands:
                    sys.stdout.write("\n")
                    sys.stdout.write("  ".join(cands) + "\n")
                    sys.stdout.write(prompt + line)
                    sys.stdout.flush()
            continue

        if ch == "\x1b":  # ESC 前缀（方向键）
            n1 = msvcrt.getwch()
            if n1 == "[":
                n2 = msvcrt.getwch()
                if n2 == "A":  # 上：更旧的历史
                    if hi > 0:
                        hi -= 1
                        buf = list(hist[hi])
                        pos = len(buf)
                        _win_redraw(prompt, buf, pos)
                elif n2 == "B":  # 下：更新的历史
                    if hi < len(hist) - 1:
                        hi += 1
                        buf = list(hist[hi])
                        pos = len(buf)
                        _win_redraw(prompt, buf, pos)
                    elif hi == len(hist) - 1:
                        hi = len(hist)
                        buf = []
                        pos = 0
                        _win_redraw(prompt, buf, pos)
                elif n2 == "C":  # 右
                    if pos < len(buf):
                        pos += 1
                        _win_redraw(prompt, buf, pos)
                elif n2 == "D":  # 左
                    if pos > 0:
                        pos -= 1
                        _win_redraw(prompt, buf, pos)
            continue

        # 可打印字符
        if ord(ch) >= 32:
            buf.insert(pos, ch)
            pos += 1
            _win_redraw(prompt, buf, pos)


# ============================================================
# Unix 实现（readline）
# ============================================================

def _unix_input(prompt: str, history: list, completer) -> str:
    import readline

    hist_file = None
    try:
        readline.set_history_length(1000)
        for h in history:
            readline.add_history(h)
    except Exception:
        pass

    if completer:
        def _complete(text, state):
            if state == 0:
                _complete.cands = completer(readline.get_line_buffer())
            cands = getattr(_complete, "cands", [])
            if state < len(cands):
                return cands[state]
            return None
        readline.set_completer_delims(" ")
        readline.parse_and_bind("tab: complete")
        readline.set_completer(_complete)

    try:
        line = input(prompt)
    finally:
        # 把本次会话新增的历史写回列表
        try:
            for i in range(1, readline.get_current_history_length() + 1):
                item = readline.get_history_item(i)
                if item and item not in history:
                    history.append(item)
        except Exception:
            pass
    return line
