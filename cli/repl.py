# -*- coding: utf-8 -*-
"""AI Hubs CLI — 交互式 REPL 与命令分发"""

from __future__ import annotations

import json
import os
import sys

from .api import APIClient, APIError
from .console import read_line

COMMANDS = [":login", ":me", ":agents", ":skills", ":datasets", ":chat", ":help", ":clear", ":quit"]

_HELP = """\
AI Hubs CLI 命令：
  :login <用户名> <密码>   登录（会话会保存，下次免登录）
  :me                     查看当前用户信息
  :agents                 列出我的 Agent
  :skills                 列出技能
  :datasets               列出数据集
  :chat <内容>            发送一条对话
  :clear                  清屏
  :help                   显示本帮助
  :quit / :exit           退出
  （直接输入任意文本也会作为对话发送）

快捷指令（一行模式）：
  python -m cli login <用户> <密码>
  python -m cli chat "你好"
  python -m cli agents | skills | datasets | me
"""


def _print_list(items: list, title: str, fields: list):
    if not items:
        print(f"（无{title}）")
        return
    print(f"{title}（共 {len(items)}）：")
    for it in items:
        parts = [str(it.get(f, "")) for f in fields]
        print("  - " + " | ".join(parts))


def _ensure_login(client: APIClient) -> bool:
    if not client.token:
        print("请先登录：:login <用户名> <密码>")
        return False
    return True


def _completer(line: str) -> list:
    if line.startswith(":"):
        return [c for c in COMMANDS if c.startswith(line)]
    return []


def _do_login(client: APIClient, args: list):
    if len(args) < 2:
        print("用法: :login <用户名> <密码>")
        return
    try:
        user = client.login(args[0], args[1])
        print(f"登录成功：{user.get('username')}（角色：{user.get('role')}）")
    except APIError as e:
        print(f"登录失败：{e}")


def _do_chat(client: APIClient, text: str):
    if not text:
        return
    if not _ensure_login(client):
        return
    try:
        sys.stdout.write("AI: ")
        for delta in client.chat(text):
            sys.stdout.write(delta)
            sys.stdout.flush()
        print()
    except APIError as e:
        print(f"\n对话失败：{e}")


def run_repl():
    client = APIClient()
    history: list = []
    print("AI Hubs CLI — 输入 :help 查看命令，直接输入文本开始对话，Ctrl-C 中断。")
    if client.token:
        print(f"已恢复会话：{client.username}")

    while True:
        try:
            line = read_line("aihubs> ", history, completer=_completer).strip()
        except (KeyboardInterrupt, EOFError):
            print("\n再见。")
            break
        if not line:
            continue
        if line in (":quit", ":exit"):
            print("再见。")
            break
        if line == ":help":
            print(_HELP)
            continue
        if line == ":clear":
            os.system("cls" if os.name == "nt" else "clear")
            continue
        if line.startswith(":login"):
            _do_login(client, line.split()[1:])
            continue
        if line == ":me":
            if _ensure_login(client):
                print(json.dumps(client.me(), ensure_ascii=False, indent=2))
            continue
        if line == ":agents":
            if _ensure_login(client):
                _print_list(client.agents(), "Agent", ["id", "name", "description"])
            continue
        if line == ":skills":
            if _ensure_login(client):
                _print_list(client.skills(), "技能", ["id", "name", "category", "source", "is_installed"])
            continue
        if line == ":datasets":
            if _ensure_login(client):
                _print_list(client.datasets(), "数据集", ["id", "name", "category", "record_count"])
            continue
        if line.startswith(":chat"):
            _do_chat(client, line[len(":chat"):].strip())
            continue
        # 默认：当作对话内容
        _do_chat(client, line)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        run_repl()
        return

    client = APIClient()
    cmd = argv[0]

    if cmd == "login":
        _do_login(client, argv[1:])
        return
    if cmd == "me":
        if _ensure_login(client):
            print(json.dumps(client.me(), ensure_ascii=False, indent=2))
        return
    if cmd == "agents":
        if _ensure_login(client):
            _print_list(client.agents(), "Agent", ["id", "name", "description"])
        return
    if cmd == "skills":
        if _ensure_login(client):
            _print_list(client.skills(), "技能", ["id", "name", "category", "source", "is_installed"])
        return
    if cmd == "datasets":
        if _ensure_login(client):
            _print_list(client.datasets(), "数据集", ["id", "name", "category", "record_count"])
        return
    if cmd == "chat":
        _do_chat(client, " ".join(argv[1:]))
        return

    print(f"未知命令: {cmd}")
    print("可用命令：login, chat, agents, skills, datasets, me")
    sys.exit(2)
