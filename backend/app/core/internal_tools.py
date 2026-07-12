# -*- coding: utf-8 -*-
"""
内部平台工具 — 让 AI 通过 Function Calling 调用项目内部 API

提供以下能力：
  call_internal_api   — 调用平台内部 REST API（Agent/任务/技能/记忆/设置等）
  request_user_input  — 请求用户交互（选择/确认/填写表单）

这些工具让 AI 可以直接：
  - 创建/修改/删除 Agent、技能、任务、数据集
  - 修改 LLM 配置、系统设置
  - 查询仪表盘、用户列表（管理员）
  - 管理对话和记忆
  - 向用户发起选择/确认交互
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("ai_hubs.internal_tools")

# ═══════════════════════════════════════════════════════════
# 内部 API 工具定义
# ═══════════════════════════════════════════════════════════

INTERNAL_API_TOOL = {
    "type": "function",
    "function": {
        "name": "call_internal_api",
        "description": (
            "调用 AI集群平台 的内部 REST API，执行平台管理操作。"
            "可用于：创建/修改/删除 Agent、管理技能、创建任务、修改 LLM 配置、"
            "管理数据集、查看仪表盘、管理用户（管理员）等。"
            "所有操作均以当前登录用户的身份执行，受用户权限限制。"
            "\n\n"
            "【可用 API 清单】\n\n"
            "## Agent 管理 (prefix: /api/v1/agents)\n"
            "- GET /agents — 列出当前用户的 Agent\n"
            "- POST /agents — 创建 Agent，body: {name, description?, system_prompt?, model?, provider?, "
            "config_mode?('global'|'self'), is_default?, enable_planning?, enable_rag?, enable_reflection?, "
            "max_iterations?, memory_strength?, setup_mode?('quick'|'detailed'), skills?, tags?, category?}\n"
            "- GET /agents/{id} — 获取 Agent 详情\n"
            "- PUT /agents/{id} — 更新 Agent，body 同创建字段\n"
            "- DELETE /agents/{id} — 删除 Agent\n"
            "- POST /agents/analyze — AI 分析推荐，body: {name, description?}，返回推荐的 system_prompt/skills/tags\n\n"
            "## 技能管理 (prefix: /api/v1/skills)\n"
            "- GET /skills — 列出技能，query: installed?(bool), source?(builtin/github/custom), search?\n"
            "- POST /skills/install — 安装技能，body: {skill_id}\n"
            "- POST /skills/uninstall — 卸载技能，body: {skill_id}\n"
            "- POST /skills/market/github — 搜索 GitHub 技能市场，body: {query, page?}\n"
            "- POST /skills/market/github/install — 从 GitHub 安装技能，body: {repo_url}\n\n"
            "## 任务管理 (prefix: /api/v1/tasks)\n"
            "- GET /tasks — 列出任务，query: status?, page?, page_size?\n"
            "- POST /tasks — 创建任务，body: {title, description?, mode?(single/sequential/parallel/debate/vote/"
            "hierarchical/swarm/custom/auto), agent_ids?, config?}\n"
            "- GET /tasks/{id} — 获取任务详情\n"
            "- PUT /tasks/{id} — 更新任务\n"
            "- DELETE /tasks/{id} — 删除任务\n"
            "- POST /tasks/{id}/execute — 执行任务\n"
            "- POST /tasks/{id}/pause — 暂停任务\n"
            "- POST /tasks/{id}/resume — 恢复任务\n\n"
            "## 记忆管理 (prefix: /api/v1/memory)\n"
            "- POST /memory/commit — 提交记忆，body: {agent_name, content, tags?}\n"
            "- GET /memory/history — 查看记忆历史，query: agent_name?, limit?\n"
            "- POST /memory/rollback — 回滚记忆，body: {entry_id}\n"
            "- POST /memory/recall — 召回记忆，body: {query, agent_name?, top_k?}\n"
            "- POST /memory/context — 获取上下文，body: {agent_name, limit?}\n\n"
            "## 数据集管理 (prefix: /api/v1/datasets)\n"
            "- GET /datasets — 列出数据集\n"
            "- POST /datasets — 创建数据集，body: {name, description?, schema_?}\n"
            "- GET /datasets/{id} — 获取数据集详情\n"
            "- PUT /datasets/{id} — 更新数据集\n"
            "- DELETE /datasets/{id} — 删除数据集\n"
            "- POST /datasets/{id}/records — 添加记录，body: {data}\n"
            "- GET /datasets/{id}/records — 列出记录，query: page?, page_size?\n\n"
            "## LLM 配置 (prefix: /api/v1/llm)\n"
            "- GET /llm/config — 获取当前 LLM 配置\n"
            "- POST /llm/config — 更新 LLM 配置，body: {provider, model, api_key, base_url?, temperature?, max_tokens?}\n"
            "- GET /llm/providers — 获取可用提供商列表\n\n"
            "## 对话管理 (prefix: /api/v1)\n"
            "- GET /conversations — 列出对话\n"
            "- POST /conversations — 创建对话，body: {title?, agent_name?}\n"
            "- DELETE /conversations/{conv_id} — 删除对话\n\n"
            "## 管理后台 (prefix: /api/v1/admin，仅管理员)\n"
            "- GET /admin/dashboard — 系统仪表盘\n"
            "- GET /admin/users — 用户列表，query: page?, page_size?, search?\n"
            "- GET /admin/users/{id} — 用户详情\n"
            "- PUT /admin/users/{id} — 更新用户，body: {username?, email?, role?, token_quota?, is_active?}\n"
            "- DELETE /admin/users/{id} — 删除用户\n\n"
            "## 用户 (prefix: /api/v1/auth)\n"
            "- GET /auth/me — 获取当前用户信息\n\n"
            "【重要】调用前先向用户说明你要做什么操作，获得隐式确认后再执行。"
            "创建/修改/删除类操作务必先告知用户。"
            "如果操作需要用户提供具体参数（如 Agent 名称、模型名），请用 request_user_input 询问。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "enum": ["GET", "POST", "PUT", "DELETE"],
                    "description": "HTTP 方法",
                },
                "path": {
                    "type": "string",
                    "description": (
                        "API 路径，以 /api/v1/ 开头。例如：'/api/v1/agents'、'/api/v1/llm/config'。"
                        "如果路径包含 {id} 等占位符，请替换为实际值。"
                    ),
                },
                "body": {
                    "type": "object",
                    "description": "请求体（POST/PUT 时使用）。JSON 对象格式。",
                },
                "query": {
                    "type": "object",
                    "description": "查询参数（GET 时使用）。例如：{'installed': true, 'search': '关键词'}",
                },
                "reason": {
                    "type": "string",
                    "description": "简短说明调用此 API 的原因（1 句话），用于日志和前端展示。",
                },
            },
            "required": ["method", "path", "reason"],
        },
    },
}

# ═══════════════════════════════════════════════════════════
# UI 操作工具定义
# ═══════════════════════════════════════════════════════════

UI_ACTION_TOOL = {
    "type": "function",
    "function": {
        "name": "ui_action",
        "description": (
            "触发前端 UI 交互操作，直接控制界面显示状态。"
            "当用户要求切换主题、切换页面、调整布局、显示/隐藏侧边栏等前端操作时使用此工具。"
            "调用后前端会立即执行对应的操作，无需用户手动点击。"
            "\n\n"
            "【支持的操作】\n\n"
            "## 主题切换\n"
            "- 'toggle_theme' — 切换明暗主题（light/dark）\n"
            "- 'set_theme' — 设置指定主题，params: {theme: 'light'|'dark'}\n\n"
            "## 页面导航\n"
            "- 'navigate' — 跳转到指定页面，params: {path: '/chat'|'/workspace'|'/tasks'|'/agents'|'/datasets'|'/knowledge'|'/workflows'|'/skills'|'/settings'}\n\n"
            "## 布局调整\n"
            "- 'toggle_sidebar' — 切换左侧边栏显示/隐藏（对话页、工作空间等）\n"
            "- 'toggle_file_tree' — 切换工作空间文件树显示/隐藏\n"
            "- 'toggle_chat_panel' — 切换工作空间聊天面板显示/隐藏\n\n"
            "## 界面操作\n"
            "- 'show_notification' — 显示通知消息，params: {type: 'success'|'error'|'info'|'warning', title: string, message?: string}\n"
            "- 'scroll_to_bottom' — 滚动到页面底部\n"
            "- 'new_chat' — 新建对话\n"
            "- 'new_task' — 打开新建任务对话框\n\n"
            "【重要】执行 UI 操作后，用一句话告知用户已完成操作即可，不要重复描述操作细节。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "要执行的 UI 操作名称",
                },
                "params": {
                    "type": "object",
                    "description": "操作参数（根据不同 action 传入不同参数）",
                },
            },
            "required": ["action"],
        },
    },
}


# ═══════════════════════════════════════════════════════════
# 用户交互工具定义
# ═══════════════════════════════════════════════════════════

USER_INPUT_TOOL = {
    "type": "function",
    "function": {
        "name": "request_user_input",
        "description": (
            "向用户发起交互请求，让用户做出选择或确认。"
            "在以下场景使用此工具：\n"
            "1. 需要用户在多个方案中做选择（如：选哪个 Agent 模板、用哪种配置模式）\n"
            "2. 执行重要操作前需要用户确认（如：删除 Agent、修改系统配置）\n"
            "3. 需要用户填写缺失的参数（如：创建 Agent 时需要名称）\n"
            "4. 用户指令模糊，需要澄清意图\n\n"
            "【交互类型】\n"
            "- 'confirm': 确认框，用户点击「确认」或「取消」\n"
            "- 'select': 选择框，用户从多个选项中选一个\n"
            "- 'multi_select': 多选框，用户从多个选项中选多个\n"
            "- 'form': 表单，用户填写多个字段\n\n"
            "【重要】优先通过交互收集信息，而不是猜测用户意图。"
            "每次只问最关键的问题，不要一次问太多。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "interaction_type": {
                    "type": "string",
                    "enum": ["confirm", "select", "multi_select", "form"],
                    "description": "交互类型",
                },
                "title": {
                    "type": "string",
                    "description": "交互标题（简短明确，如「确认删除 Agent？」、「选择配置模式」）",
                },
                "message": {
                    "type": "string",
                    "description": "详细说明文字，解释为什么需要用户输入以及每个选项的含义",
                },
                "options": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "description": "选项显示文本"},
                            "value": {"type": "string", "description": "选项值"},
                            "description": {"type": "string", "description": "选项详细说明（可选）"},
                        },
                        "required": ["label", "value"],
                    },
                    "description": "选项列表（select / multi_select 时必填）",
                },
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "字段名"},
                            "label": {"type": "string", "description": "字段标签"},
                            "type": {"type": "string", "enum": ["text", "number", "textarea", "select", "password"], "description": "字段类型"},
                            "placeholder": {"type": "string", "description": "占位提示"},
                            "required": {"type": "boolean", "description": "是否必填"},
                            "options": {
                                "type": "array",
                                "items": {"type": "object", "properties": {"label": {"type": "string"}, "value": {"type": "string"}}, "required": ["label", "value"]},
                                "description": "select 类型的选项",
                            },
                            "default": {"type": "string", "description": "默认值"},
                        },
                        "required": ["name", "label", "type"],
                    },
                    "description": "表单字段定义（form 类型时必填）",
                },
                "confirm_text": {
                    "type": "string",
                    "description": "确认按钮文字（默认「确认」）",
                },
                "cancel_text": {
                    "type": "string",
                    "description": "取消按钮文字（默认「取消」）",
                },
            },
            "required": ["interaction_type", "title", "message"],
        },
    },
}

# ═══════════════════════════════════════════════════════════
# 内部 API 调用执行器
# ═══════════════════════════════════════════════════════════

async def execute_internal_api(
    method: str,
    path: str,
    user_token: str,
    body: dict | None = None,
    query: dict | None = None,
    reason: str = "",
) -> str:
    """执行内部 API 调用。

    在 chat 的 event_stream 中，我们通过注入 user_token 来调用内部 API。
    使用 httpx 异步客户端发起请求到 localhost。

    Args:
        method: HTTP 方法
        path: API 路径
        user_token: 当前用户的 JWT Token
        body: 请求体
        query: 查询参数
        reason: 调用原因

    Returns:
        JSON 字符串结果
    """
    import httpx

    # 确保路径以 / 开头
    if not path.startswith("/"):
        path = "/" + path

    url = f"http://127.0.0.1:8082{path}"
    headers = {
        "Authorization": f"Bearer {user_token}",
        "Content-Type": "application/json",
    }

    logger.info(f"Internal API call: {method} {path} (reason: {reason})")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if method == "GET":
                resp = await client.get(url, headers=headers, params=query or {})
            elif method == "POST":
                resp = await client.post(url, headers=headers, json=body or {})
            elif method == "PUT":
                resp = await client.put(url, headers=headers, json=body or {})
            elif method == "DELETE":
                resp = await client.delete(url, headers=headers)
            else:
                return json.dumps({"error": f"不支持的 HTTP 方法: {method}"}, ensure_ascii=False)

            # 尝试解析 JSON 响应
            try:
                data = resp.json()
            except Exception:
                data = {"raw": resp.text[:500]}

            # 脱敏处理：移除响应中的敏感信息
            if isinstance(data, dict):
                # 脱敏 api_key
                if "config" in data and isinstance(data["config"], dict):
                    if "api_key" in data["config"]:
                        data["config"]["api_key"] = "***已配置***" if data["config"]["api_key"] else "未配置"
                # 脱敏用户列表中的敏感字段
                if "users" in data and isinstance(data["users"], list):
                    for u in data["users"]:
                        u.pop("password_hash", None)
                        u.pop("llm_config", None)

            result = {
                "ok": resp.is_success,
                "status": resp.status_code,
                "data": data,
                "reason": reason,
            }
            return json.dumps(result, ensure_ascii=False, default=str)

    except httpx.ConnectError:
        return json.dumps({
            "ok": False,
            "error": "无法连接到内部 API 服务（127.0.0.1:8080），请确认后端服务正在运行",
            "reason": reason,
        }, ensure_ascii=False)
    except Exception as e:
        logger.exception(f"Internal API call failed: {method} {path}")
        return json.dumps({
            "ok": False,
            "error": f"内部 API 调用失败: {str(e)}",
            "reason": reason,
        }, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════
# 用户交互请求处理
# ═══════════════════════════════════════════════════════════

def build_interactive_event(
    interaction_type: str,
    title: str,
    message: str,
    options: list[dict] | None = None,
    fields: list[dict] | None = None,
    confirm_text: str = "确认",
    cancel_text: str = "取消",
) -> dict:
    """构建交互事件，通过 SSE 发送给前端渲染。

    这个函数不执行实际交互，而是生成一个特殊事件，
    前端收到后会在消息流中渲染对应的交互组件。

    Returns:
        交互事件 dict，包含 type='interactive' 和所有渲染所需数据
    """
    event: dict[str, Any] = {
        "type": "interactive",
        "interaction_type": interaction_type,
        "title": title,
        "message": message,
        "confirm_text": confirm_text,
        "cancel_text": cancel_text,
        # 生成唯一 ID，用于前端回传用户响应
        "interaction_id": f"int_{hash(title + message) & 0xFFFFFFFF:08x}",
    }

    if options:
        event["options"] = options
    if fields:
        event["fields"] = fields

    return event


def build_ui_action_event(action: str, params: dict | None = None) -> dict:
    """构建 UI 操作事件，通过 SSE 发送给前端执行。

    这个函数不执行实际操作，而是生成一个特殊事件，
    前端收到后会执行对应的 UI 操作（切换主题、跳转页面等）。

    Returns:
        UI 操作事件 dict，包含 type='ui_action' 和 action/params
    """
    return {
        "type": "ui_action",
        "action": action,
        "params": params or {},
    }
