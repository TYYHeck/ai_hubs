# -*- coding: utf-8 -*-
"""
CLI 交互界面 —— 命令行中的 Agent 对话

特性:
  - 流式打字机效果 (通过 Agent.stream)
  - 命令系统 (/help /stats /clear /tools /rag /recall /model /task /agent)
  - Tab 命令补全与历史记录 (prompt_toolkit)
  - 颜色渲染 (Rich 库)
  - 调试模式 (显示 Agent 内部状态)
  - Agent 管理 (/agent list, /agent new)
  - 任务发布 (/task publish, /task list, /task status)
"""

from __future__ import annotations
from typing import Optional
import sys
import os
import time
from datetime import datetime
import atexit

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# ── readline 补全 / 历史 (prompt_toolkit 不兼容时的备选) ──
try:
    import readline
    READLINE_AVAILABLE = True
except ImportError:
    try:
        import pyreadline3 as readline
        READLINE_AVAILABLE = True
    except ImportError:
        READLINE_AVAILABLE = False

# ── prompt_toolkit (优先) ──
try:
    from prompt_toolkit import PromptSession
    from prompt_toolkit.history import FileHistory
    from prompt_toolkit.completion import Completer, Completion
    from prompt_toolkit.styles import Style
    from prompt_toolkit.formatted_text import HTML
    from prompt_toolkit.output import create_output as pt_create_output
    PT_AVAILABLE = True
except ImportError:
    PT_AVAILABLE = False

try:
    from rich.console import Console
    from rich.markdown import Markdown
    from rich.panel import Panel
    from rich.table import Table
    from rich.syntax import Syntax
    from rich.live import Live
    from rich.text import Text
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

from src.core.agent import Agent, AgentEvent
from src.core.llm import LLMConfig


# ======== prompt_toolkit 补全器 ========

class _CommandCompleter(Completer):
    """Tab 补全器：补全命令 + 子命令 + 上下文参数"""

    def __init__(self, cli: "CLI"):
        self.cli = cli

    def get_completions(self, document, complete_event):
        text = document.text_before_cursor.lstrip()
        tokens = text.split() if text else []
        word_before = document.get_word_before_cursor()

        candidates = self._get_candidates(tokens, word_before, text)

        for c in candidates:
            if c.startswith(word_before):
                yield Completion(c, start_position=-len(word_before))

    def _get_candidates(
        self, tokens: list[str], word_before: str, text: str
    ) -> list[str]:
        """根据当前输入上下文返回候选列表"""

        # 空行或刚输入 / → 所有根命令
        if not tokens or (len(tokens) == 1 and text.rstrip().endswith("/")):
            return CLI.ROOT_COMMANDS

        first = tokens[0] if tokens else ""

        # ── /task 子命令 ──
        if first == "/task":
            if len(tokens) == 1:
                return CLI.TASK_SUB
            if len(tokens) == 2 and tokens[1] not in CLI.TASK_SUB:
                return CLI.TASK_SUB
            if tokens[1] == "list" and len(tokens) >= 2:
                return ["pending", "running", "completed", "failed", "cancelled"]
            if tokens[1] in ("status", "cancel") and len(tokens) >= 2:
                return self._get_task_ids()
            if tokens[1] == "publish":
                return self._publish_opts(tokens)

        # ── /agent 子命令 ──
        if first == "/agent":
            if len(tokens) == 1:
                return CLI.AGENT_SUB
            if len(tokens) == 2 and tokens[1] not in CLI.AGENT_SUB:
                return CLI.AGENT_SUB
            if tokens[1] == "create":
                return self._agent_create_opts(tokens)

        # ── /recall → 不补全（自由文本）──
        if first == "/recall":
            return []

        # ── /model → 补全模型名 ──
        if first == "/model":
            if len(tokens) <= 2:
                return self._get_model_ids()

        # ── 默认：补全根命令 ──
        if len(tokens) == 1 and first.startswith("/"):
            return CLI.ROOT_COMMANDS

        return []

    def _get_task_ids(self) -> list[str]:
        try:
            from src.core.task_manager import get_task_manager
            tm = get_task_manager()
            tasks = tm.list_tasks(limit=50)
            return [t["id"] for t in tasks]
        except Exception:
            return []

    def _get_model_ids(self) -> list[str]:
        try:
            models = self.cli.agent.available_models()
            return [m["id"] for m in models]
        except Exception:
            return []

    def _get_agent_names(self) -> list[str]:
        try:
            from src.core.task_manager import get_task_manager
            tm = get_task_manager()
            agents = tm.list_agents()
            return [a["name"] for a in agents]
        except Exception:
            return []

    def _publish_opts(self, tokens: list[str]) -> list[str]:
        opts = ["--agent"]
        if "--agent" in tokens:
            idx = tokens.index("--agent")
            if idx + 1 >= len(tokens):
                return self._get_agent_names()
        return opts

    def _agent_create_opts(self, tokens: list[str]) -> list[str]:
        if len(tokens) == 2:
            return self._get_model_ids()
        if len(tokens) == 3:
            model_ids = self._get_model_ids()
            if tokens[2] in model_ids:
                return ["deepseek", "openai", "dashscope"]
            return model_ids
        if len(tokens) == 4:
            return ["deepseek", "openai", "dashscope"]
        return []


# ======== Agent 工厂 ========

def _create_side_agent(
    name: str,
    model: str,
    provider: str = "deepseek",
    skills: list[str] | None = None,
    description: str = "",
):
    """创建并注册一个独立 Agent 到 TaskManager"""
    from src.core.task_manager import get_task_manager, AgentProxy
    from src.core.llm import create_llm

    config = LLMConfig(provider=provider, model=model)
    agent = Agent()
    agent.name = name

    # 根据技能构建专门的 system_prompt
    skill_desc = f"专注于{'、'.join(skills)}" if skills else "通用"
    agent.system_prompt = (
        f"你是 {name}，一个{skill_desc}的 AI 助手。"
        f"请用你的专业知识高效完成用户的任务。"
    )
    agent.init(config)

    # 注册内置工具
    from src.tools.builtin_tools import register_all
    register_all(agent.tools)
    agent._rebuild_graph()

    tm = get_task_manager()
    proxy = AgentProxy(
        name=name,
        agent=agent,
        skills=skills or [],
        description=description or f"{skill_desc}型 Agent",
    )
    tm.register_agent(proxy)
    tm.start_dispatcher()
    return agent


# ── readline 回退补全器 ──

class _ReadlineCompleter:
    """readline 兼容的补全器（当 prompt_toolkit 不可用时）"""

    def __init__(self, cli: "CLI"):
        self.cli = cli

    def complete(self, text: str, state: int):
        """readline 补全回调"""
        try:
            line = readline.get_line_buffer()
        except Exception:
            return None
        tokens = line.lstrip().split() if line else []
        cursor_pos = readline.get_endidx() if hasattr(readline, 'get_endidx') else len(line)

        candidates = self._get_candidates(tokens, text, line)
        filtered = [c for c in candidates if c.startswith(text)] if text else list(candidates)
        seen = set()
        unique = []
        for c in filtered:
            if c not in seen:
                seen.add(c)
                unique.append(c)
        try:
            return unique[state]
        except IndexError:
            return None

    def _get_candidates(self, tokens, word_before, text):
        if not tokens or (len(tokens) == 1 and text.rstrip().endswith("/")):
            return CLI.ROOT_COMMANDS
        first = tokens[0] if tokens else ""

        if first == "/task":
            if len(tokens) == 1:
                return CLI.TASK_SUB
            if len(tokens) == 2 and tokens[1] not in CLI.TASK_SUB:
                return CLI.TASK_SUB
            if tokens[1] == "list" and len(tokens) >= 2:
                return ["pending", "running", "completed", "failed", "cancelled"]
            if tokens[1] in ("status", "cancel") and len(tokens) >= 2:
                try:
                    from src.core.task_manager import get_task_manager
                    tm = get_task_manager()
                    return [t["id"] for t in tm.list_tasks(limit=50)]
                except Exception:
                    return []
            if tokens[1] == "publish":
                return ["--agent"]

        if first == "/agent":
            if len(tokens) == 1:
                return CLI.AGENT_SUB
            if len(tokens) == 2 and tokens[1] not in CLI.AGENT_SUB:
                return CLI.AGENT_SUB

        if first == "/model" and len(tokens) <= 2:
            try:
                models = self.cli.agent.available_models()
                return [m["id"] for m in models]
            except Exception:
                return []

        if first == "/recall":
            return []

        if len(tokens) == 1 and first.startswith("/"):
            return CLI.ROOT_COMMANDS

        return []


class CLI:
    """命令行交互界面"""

    # ── 所有支持的命令（用于 Tab 补全）──
    ROOT_COMMANDS = [
        "/help", "/?", "/exit", "/quit", "/q",
        "/debug", "/tools", "/stats", "/clear",
        "/plan", "/rag", "/reflect",
        "/recall", "/kb_stats", "/model",
        "/task", "/agent",
    ]
    TASK_SUB = ["publish", "list", "status", "queue", "cancel"]
    AGENT_SUB = ["list", "register", "unregister", "create"]

    def __init__(self, agent: Agent):
        self.agent = agent
        self.debug = False
        self.show_tool_calls = True
        self.conversation_count = 0
        self._use_readline = False

        # 设置事件回调
        self.agent.on_event = self._on_agent_event

        if RICH_AVAILABLE:
            self.console = Console()
        else:
            self.console = None

        # ── 初始化 prompt_toolkit 会话 ──
        self._setup_prompt_toolkit()

    # ======== prompt_toolkit 补全 / 历史 ========

    def _setup_prompt_toolkit(self):
        """配置 Tab 补全、历史记录与输入样式"""
        self._history_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            ".cli_history",
        )
        self._session = None

        # 输入样式
        self._prompt_style = Style.from_dict({
            "prompt": "bold cyan",
            "": "",
        })

        if PT_AVAILABLE:
            # 检测终端兼容性：Windows PowerShell + VSCode 终端可能有不兼容
            try:
                pt_create_output()
            except Exception as e:
                print(f"[Warn] prompt_toolkit 与当前终端不兼容 ({e})，使用回退方案")

                # ── 回退：readline / pyreadline3 ──
                if READLINE_AVAILABLE:
                    self._setup_readline_fallback()
                    return
                else:
                    print("[Warn] Tab 补全不可用（请使用传统 cmd.exe 或安装 pyreadline3）")
                    return

            self._session = PromptSession(
                history=FileHistory(self._history_file),
                completer=_CommandCompleter(self),
                style=self._prompt_style,
                complete_while_typing=False,
            )
        else:
            print("[Warn] prompt_toolkit 未安装")

            # ── 回退：readline / pyreadline3 ──
            if READLINE_AVAILABLE:
                self._setup_readline_fallback()
            else:
                print("[Warn] 安装 prompt_toolkit 可获得 Tab 补全: pip install prompt_toolkit")

    def _setup_readline_fallback(self):
        """使用 readline/pyreadline3 作为备选补全方案"""
        try:
            readline.read_history_file(self._history_file)
        except (FileNotFoundError, OSError):
            pass
        readline.set_history_length(500)
        atexit.register(lambda: readline.write_history_file(self._history_file))

        self._readline_completer = _ReadlineCompleter(self)
        readline.set_completer(self._readline_completer.complete)
        readline.parse_and_bind("tab: complete")
        readline.set_completer_delims(" \t\n;")
        self._use_readline = True

    def _on_agent_event(self, event: AgentEvent, data):
        """Agent 内部事件 → UI 显示"""
        if event == AgentEvent.TOOL_CALL and self.show_tool_calls:
            self._print_tool_call(data)
        elif event == AgentEvent.TOOL_RESULT and self.show_tool_calls:
            self._print_tool_result(data)
        elif event == AgentEvent.ERROR and self.debug:
            self._print(f"[Error] {data.get('error', 'unknown')}", style="red")

    def _print(self, text: str, style: str = ""):
        """统一输出"""
        if self.console:
            self.console.print(text, style=style or None)
        else:
            print(text)

    def _print_tool_call(self, data):
        """显示工具调用"""
        name = data.get("name", "unknown")
        args = data.get("arguments", {})
        if self.console:
            self.console.print(
                f"  [tool] [cyan]{name}[/cyan] "
                f"[dim]({str(args)[:80]})[/dim]",
            )
        else:
            print(f"  [Tool] {name}({str(args)[:80]})")

    def _print_tool_result(self, data):
        """显示工具结果"""
        result = str(data.get("result", ""))[:120]
        success = data.get("success", False)
        icon = "[green]OK[/green]" if success else "[red]FAIL[/red]"
        if self.console:
            self.console.print(f"     {icon} [dim]{result}[/dim]")
        else:
            print(f"     {'OK' if success else 'FAIL'}: {result}")

    def _print_banner(self):
        banner = r"""
  +==========================================+
  |    SmartAgent - 智能 AI 助手              |
  |    思考 · 行动 · 观察 · 学习              |
  +==========================================+
"""
        if self.console:
            self.console.print(banner, style="bold cyan")
            self.console.print(
                f"  模型: {self.agent.llm.config.model if self.agent.llm else 'N/A'}"
                f"  |  Provider: {self.agent.llm.config.provider if self.agent.llm else 'N/A'}",
                style="dim",
            )
            self.console.print(
                f"  工具: {len(self.agent.tools)} 个"
                f"  |  LangChain: {'[green]启用[/green]' if self.agent._agent_graph else '[yellow]兼容模式[/yellow]'}",
                style="dim",
            )
            modes = []
            if self.agent.enable_planning:
                modes.append("[P] 计划")
            if self.agent.enable_rag:
                modes.append("[R] RAG")
            if self.agent.enable_reflection:
                modes.append("[V] 反思")
            self.console.print(
                f"  模式: {' '.join(modes) if modes else '(默认)'}",
                style="dim",
            )
            self.console.print(
                "  输入 /help 查看命令 | /exit 退出\n",
                style="dim",
            )
        else:
            print(banner)
            print(f"  模型: {self.agent.llm.config.model if self.agent.llm else 'N/A'}")
            print(f"  输入 /help 查看命令 | /exit 退出\n")

    def _print_response(self, text: str):
        """渲染 Agent 回复"""
        if self.console:
            self.console.print()
            try:
                md = Markdown(text)
                self.console.print(md)
            except Exception:
                self.console.print(text)
            self.console.print()
        else:
            print(f"\n[Agent] {text}\n")

    def _handle_command(self, cmd: str) -> bool:
        """处理斜杠命令，返回 False 表示退出"""
        parts = cmd.split()
        command = parts[0].lower()

        if command in ("/exit", "/quit", "/q"):
            print("再见!")
            return False

        elif command in ("/help", "/?"):
            self._show_help()

        elif command == "/debug":
            self.debug = not self.debug
            print(f"[Debug] 调试模式: {'开' if self.debug else '关'}")

        elif command == "/tools":
            self._show_tools()

        elif command == "/stats":
            self._show_stats()

        elif command == "/clear":
            self.agent.memory.short.clear()
            self.agent.memory.set_system(self.agent._build_system_prompt())
            print("对话已清空")

        elif command == "/plan":
            self.agent.enable_planning = not self.agent.enable_planning
            print(f"计划模式: {'开' if self.agent.enable_planning else '关'}")

        elif command == "/rag":
            self.agent.enable_rag = not self.agent.enable_rag
            print(f"RAG 知识库: {'开' if self.agent.enable_rag else '关'}")

        elif command == "/reflect":
            self.agent.enable_reflection = not self.agent.enable_reflection
            print(f"反思模式: {'开' if self.agent.enable_reflection else '关'}")

        elif command == "/recall" and len(parts) > 1:
            query = " ".join(parts[1:])
            results = self.agent.memory.recall(query)
            if results:
                print(f"[Memory] {results}")
            else:
                print("[Memory] 没有找到相关记忆")

        elif command == "/kb_stats":
            if self.agent.knowledge:
                s = self.agent.knowledge.stats()
                print(f"[KB] 知识库: {s['chunks']} 个文档块, {s['sources']} 个来源")
            else:
                print("[KB] 知识库未启用")

        elif command == "/model":
            self._handle_model_command(parts)

        elif command == "/task":
            self._handle_task_command(parts)

        elif command == "/agent":
            self._handle_agent_command(parts)

        else:
            print(f"未知命令: {command}，输入 /help 查看帮助")

        return True

    def _handle_model_command(self, parts: list[str]):
        """处理 /model 命令"""
        models = self.agent.available_models()
        if len(parts) > 1:
            target = parts[1]
            found = next((m for m in models if m["id"] == target), None)
            if found:
                self.agent.switch_model(
                    model=found["id"],
                    provider=found["provider"],
                    base_url="" if found["provider"] == "openai" else None,
                )
                print(f"[Model] 已切换到 {found['name']} ({found['id']})")
            else:
                print(f"[Model] 未知模型: {target}")
                print(f"  可用: {', '.join(m['id'] for m in models)}")
        else:
            current = self.agent.llm.config.model if self.agent.llm else "N/A"
            provider = self.agent.llm.config.provider if self.agent.llm else "N/A"
            print(f"[Model] 当前提供商: {provider} | 当前模型: {current}")
            print(f"  可用模型 (来自 {provider} API):")
            for m in models:
                mark = " <-- 当前" if m["id"] == current else ""
                print(f"    {m['id']}{mark}")
            print(f"  用法: /model <模型id>")

    def _handle_task_command(self, parts: list[str]):
        """处理 /task 命令 —— 任务发布与管理"""
        from src.core.task_manager import get_task_manager
        tm = get_task_manager()

        if len(parts) < 2:
            print("用法:")
            print("  /task publish <描述>    发布新任务")
            print("  /task list [状态]      列出任务 (pending/running/completed)")
            print("  /task status <id>      查看任务详情")
            print("  /task queue            查看队列状态")
            print("  /task cancel <id>      取消任务")
            return

        sub = parts[1].lower()

        if sub == "publish" and len(parts) > 2:
            # 支持 --agent <名称> 指定执行 Agent
            desc_parts = parts[2:]
            target = ""
            if "--agent" in desc_parts:
                idx = desc_parts.index("--agent")
                if idx + 1 < len(desc_parts):
                    target = desc_parts[idx + 1]
                    desc_parts = desc_parts[:idx] + desc_parts[idx + 2:]
            desc = " ".join(desc_parts)
            tid = tm.publish(desc, priority=5, target_agent=target)
            print(f"[Task] 任务已发布: {tid}")
            print(f"  描述: {desc[:100]}")
            if target:
                print(f"  分配至: {target}")

        elif sub == "list":
            status = parts[2] if len(parts) > 2 else ""
            tasks = tm.list_tasks(status=status, limit=20)
            if not tasks:
                print("[Task] 暂无任务")
            else:
                for t in tasks:
                    status_icon = {
                        "pending": "○", "running": "◎",
                        "completed": "●", "failed": "✕", "cancelled": "−",
                    }.get(t["status"], "?")
                    print(f"  {status_icon} [{t['id']}] {t['status']:10s} {t['title']}")

        elif sub == "status" and len(parts) > 2:
            tid = parts[2]
            task = tm.get_task(tid)
            if task:
                print(f"\n{'='*50}")
                print(f"  任务: {task['title']}")
                print(f"  状态: {task['status']}  |  Agent: {task.get('assigned_agent', '未分配')}")
                print(f"  创建: {task['created_at']}")
                if task.get('started_at'):
                    print(f"  开始: {task['started_at']}")
                if task.get('finished_at'):
                    print(f"  完成: {task['finished_at']}")
                if task.get('error'):
                    print(f"  错误: {task['error']}")
                if task.get('result'):
                    print(f"  结果: {task['result'][:300]}")

                # 执行过程
                event_log = task.get("event_log", [])
                if event_log:
                    print(f"\n  --- 执行过程 ({len(event_log)} 个事件) ---")
                    for evt in event_log:
                        evt_name = evt.get("event", "?")
                        evt_time = evt.get("time", "")[-8:]  # HH:MM:SS
                        evt_data = str(evt.get("data", ""))[:80]
                        icon = {
                            "assigned": "📌", "think_start": "🤔", "think_end": "💡",
                            "tool_call": "🔧", "tool_result": "✅",
                            "plan_created": "📋", "completed": "🏁", "error": "❌",
                        }.get(evt_name, "  ")
                        print(f"    {evt_time} {icon} {evt_name}: {evt_data}")
                print(f"{'='*50}\n")
            else:
                print(f"[Task] 未找到任务: {tid}")

        elif sub == "queue":
            status = tm.queue_status()
            print(f"[Task] 队列状态:")
            print(f"  待处理: {status['pending']}")
            print(f"  执行中: {status['running']}")
            print(f"  已完成: {status['completed']}")
            print(f"  已失败: {status['failed']}")
            print(f"  Agent: {status['agents']} 个 (空闲: {status['idle_agents']})")

        elif sub == "cancel" and len(parts) > 2:
            tid = parts[2]
            tm.cancel_task(tid)
            print(f"[Task] 任务已取消: {tid}")

    def _handle_agent_command(self, parts: list[str]):
        """处理 /agent 命令 —— Agent 管理"""
        from src.core.task_manager import get_task_manager, AgentProxy
        tm = get_task_manager()

        if len(parts) < 2:
            print("用法:")
            print("  /agent list         列出所有 Agent")
            print("  /agent register     注册当前 Agent 到任务管理器")
            print("  /agent unregister   注销当前 Agent")
            return

        sub = parts[1].lower()

        if sub == "list":
            agents = tm.list_agents()
            if not agents:
                print("[Agent] 暂无已注册 Agent")
            else:
                for a in agents:
                    status_icon = "●" if a["status"] == "idle" else "◎"
                    task_info = f" [{a['current_task_id']}]" if a.get("current_task_id") else ""
                    skills_str = f"  [{', '.join(a.get('skills', []))}]" if a.get("skills") else ""
                    desc_str = f" — {a.get('description', '')}" if a.get("description") else ""
                    print(f"  {status_icon} {a['name']} ({a['status']}){skills_str}{desc_str}{task_info}")

        elif sub == "register":
            proxy = AgentProxy(name=self.agent.name, agent=self.agent)
            tm.register_agent(proxy)
            tm.start_dispatcher()
            print(f"[Agent] 已注册并启动调度: {self.agent.name}")

        elif sub == "create":
            if len(parts) < 4:
                print("用法: /agent create <名称> <模型> [provider] [--skills <技能1,技能2>]")
                print("示例: /agent create 编码师 gpt-4o openai --skills coding,shell")
                print("      /agent create 研究员 deepseek-chat --skills research,writing")
                print()
                print("可用技能标签: coding, research, writing, data, file_ops, shell")
                return
            agent_name = parts[2]
            model = parts[3]

            # 解析剩余参数
            remaining = parts[4:]
            provider = self.agent.llm.provider if self.agent.llm else "deepseek"
            skills: list[str] = []

            i = 0
            while i < len(remaining):
                if remaining[i] == "--skills" and i + 1 < len(remaining):
                    skills = [s.strip() for s in remaining[i + 1].split(",")]
                    i += 2
                elif remaining[i] not in ("--skills",):
                    provider = remaining[i]
                    i += 1
                else:
                    i += 1

            _create_side_agent(agent_name, model, provider, skills=skills,
                               description=f"{'、'.join(skills)}型 Agent" if skills else "通用型 Agent")
            skill_str = f", 技能: {', '.join(skills)}" if skills else ""
            print(f"[Agent] 已创建并注册: {agent_name} (模型: {model}, 供应商: {provider}{skill_str})")

        elif sub == "unregister":
            tm.unregister_agent(self.agent.name)
            print(f"[Agent] 已注销: {self.agent.name}")

    def _show_help(self):
        help_text = """
        --- SmartAgent 命令列表 ---
        ─────────────────────────────────────────
        对话命令:
          /help, /?           显示此帮助
          /exit, /q           退出程序
          /clear              清空对话记忆
          /debug              切换调试模式

        工具与状态:
          /tools              列出所有已注册工具
          /stats              显示运行统计
          /kb_stats           知识库统计

        模式切换:
          /plan               切换任务计划模式
          /rag                切换 RAG 知识库增强
          /reflect            切换自我反思模式

        模型管理:
          /model              查看当前模型
          /model <id>         切换模型

        记忆检索:
          /recall <查询>      搜索长期记忆

        任务管理:
          /task publish <描述> [--agent <名称>]  发布新任务
          /task list [状态]      列出任务
          /task status <id>      查看任务详情
          /task queue            查看队列状态
          /task cancel <id>      取消任务

        Agent 管理:
          /agent list            列出所有 Agent (含技能标签)
          /agent register        注册当前 Agent
          /agent unregister      注销当前 Agent
          /agent create <名称> <模型> [provider] [--skills <技能>]
                                 创建新 Agent (支持技能标签)
        """
        print(help_text)

    def _show_tools(self):
        print(f"\n--- 已注册工具 ({len(self.agent.tools)} 个) ---")
        for tool in self.agent.tools.list_all():
            danger = " [!]" if tool.dangerous else ""
            params = ", ".join(tool.parameters.keys())
            print(f"  - {tool.name}({params}){danger}")
            print(f"    {tool.description}")
        print()

    def _show_stats(self):
        print(f"\n--- 运行统计 ---")
        print(f"  对话轮数: {self.conversation_count}")
        print(f"  短期记忆消息数: {len(self.agent.memory.short)}")
        print(f"  工具数量: {len(self.agent.tools)}")
        print(f"  LangChain Agent: {'启用' if self.agent._agent_graph else '兼容模式'}")
        if self.agent.knowledge:
            s = self.agent.knowledge.stats()
            print(f"  知识库: {s['chunks']} 块, {s['sources']} 个来源")
        print()

    def start(self):
        """启动交互循环"""
        self._print_banner()

        while True:
            try:
                if self._session:
                    user_input = self._session.prompt(
                        HTML("<prompt>>> </prompt>"),
                    ).strip()
                else:
                    user_input = input(">> ").strip()
            except (KeyboardInterrupt, EOFError):
                print("\n再见!")
                break

            if not user_input:
                continue

            # 太短的输入提示
            if len(user_input) <= 2 and not user_input.startswith("/"):
                print("[Hint] 输入太短了，试着描述清楚你想做什么？")
                continue

            # 处理命令
            if user_input.startswith("/"):
                if not self._handle_command(user_input):
                    break
                continue

            self.conversation_count += 1

            try:
                if self.console:
                    with self.console.status("[cyan]思考中...[/cyan]"):
                        result = self.agent.run(user_input)
                else:
                    print("[Thinking] 思考中...")
                    result = self.agent.run(user_input)
            except KeyboardInterrupt:
                print("\n再见!")
                break
            except Exception as e:
                if self.debug:
                    import traceback
                    traceback.print_exc()
                print(f"[Error] 错误: {e}")
                continue

            self._print_response(result)


def main():
    """CLI 入口函数"""
    import yaml
    from src.core.llm import LLMConfig
    from src.tools.builtin_tools import register_all, ALL_BUILTIN_TOOLS
    from src.core.agent import Agent

    # 1. 加载配置
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "config.yaml",
    )

    if os.path.exists(config_path):
        with open(config_path, encoding="utf-8") as f:
            config_data = yaml.safe_load(f)
    else:
        config_data = {}

    # 2. 创建 LLM 配置
    llm_cfg_data = config_data.get("llm", {})
    llm_config = LLMConfig(
        provider=llm_cfg_data.get("provider", "openai"),
        model=llm_cfg_data.get("model", "gpt-4o"),
        api_key=llm_cfg_data.get("api_key", ""),
        base_url=llm_cfg_data.get("base_url", ""),
        temperature=float(llm_cfg_data.get("temperature", 0.7)),
        max_tokens=int(llm_cfg_data.get("max_tokens", 4096)),
        timeout=int(llm_cfg_data.get("timeout", 60)),
    )

    # 3. 检查 API Key
    if not llm_config.resolve_api_key():
        print("=" * 60)
        print("[Error] 未检测到 API Key!")
        print()
        print("请设置以下环境变量之一:")
        print("  PowerShell: $env:OPENAI_API_KEY='sk-xxx'")
        print("  bash:       export OPENAI_API_KEY=sk-xxx")
        print()
        print("提示: OPENAI_API_KEY 可作为所有 provider 的通用 fallback")
        print()
        print("支持的提供商专用变量:")
        print("  - OPENAI_API_KEY    (OpenAI / 通用兜底)")
        print("  - DEEPSEEK_API_KEY  (DeepSeek)")
        print("  - DASHSCOPE_API_KEY (阿里通义)")
        print("  - ZHIPU_API_KEY     (智谱)")
        print(f"  当前 provider: {llm_config.provider}")
        print("=" * 60)
        return

    # 3.5. 初始化 Tracing
    from src.core.tracing import init_tracing
    tracing_cfg = config_data.get("tracing", {})
    init_tracing(
        project=tracing_cfg.get("project", "smart_agent"),
        enabled=tracing_cfg.get("enabled", False),
    )

    # 4. 创建 Agent
    agent = Agent()
    agent.init(llm_config)
    agent.system_prompt = config_data.get("agent", {}).get(
        "system_prompt",
        "你是一个智能 AI 助手，具备工具使用、文件操作、代码执行等能力。",
    )
    agent.max_iterations = config_data.get("agent", {}).get("max_iterations", 15)
    agent.verbose = config_data.get("agent", {}).get("verbose", True)

    # 5. 注册工具
    register_all(agent.tools)
    agent._rebuild_graph()

    # 5.5. 自动注册当前 Agent 到 TaskManager
    from src.core.task_manager import get_task_manager, AgentProxy
    tm = get_task_manager()
    agent_name = config_data.get("agent", {}).get("name", "SmartAgent")
    proxy = AgentProxy(
        name=agent_name,
        agent=agent,
        skills=config_data.get("agent", {}).get("skills", ["通用"]),
        description="默认 Agent，CLI 启动时自动注册",
    )
    tm.register_agent(proxy)
    tm.start_dispatcher()

    # 6. 启动 CLI
    cli = CLI(agent)
    cli.start()


if __name__ == "__main__":
    main()
