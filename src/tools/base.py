# -*- coding: utf-8 -*-
"""
工具注册系统 —— Agent 能力的基石

设计思路:
  1. @tool 装饰器 → 把普通函数变成 Agent 可用工具
  2. 自动从 type hints 生成 JSON Schema (给 LLM 看)
  3. ToolRegistry 管理所有已注册的工具
  4. 支持同步/异步工具
  5. 新增 to_langchain_tool() → 转为 LangChain StructuredTool

LangChain 集成:
  - to_langchain_tool() 将内部 Tool 转为 langchain.tools.StructuredTool
  - Agent 构建时自动调用此方法生成 LangChain 工具列表

使用方式:
  @tool(description="搜索互联网内容", dangerous=False)
  def web_search(query: str, num_results: int = 5) -> list[dict]:
      ...
"""

from __future__ import annotations
from typing import Callable, Any, get_type_hints, get_origin, get_args, Literal
from dataclasses import dataclass, field
import inspect
import json
import asyncio
import logging

logger = logging.getLogger("ai_hubs.tools")


# ============================================================
# 1. Python 类型 → JSON Schema 类型 映射
# ============================================================

def python_type_to_json_type(py_type) -> dict:
    """将 Python 类型提示转为 JSON Schema 类型定义"""
    origin = get_origin(py_type)

    if py_type is str:
        return {"type": "string"}
    elif py_type is int:
        return {"type": "integer"}
    elif py_type is float:
        return {"type": "number"}
    elif py_type is bool:
        return {"type": "boolean"}
    elif py_type is list or origin is list:
        inner_type = get_args(py_type)
        if inner_type and inner_type[0] is dict:
            return {"type": "array", "items": {"type": "object"}}
        return {"type": "array", "items": {"type": "string"}}
    elif py_type is dict or origin is dict:
        return {"type": "object"}
    elif origin is Literal:
        return {"type": "string", "enum": list(get_args(py_type))}
    else:
        return {"type": "string"}


# ============================================================
# 2. Tool 定义 (装饰器产物)
# ============================================================

@dataclass
class Tool:
    """一个注册好的工具"""

    name: str                        # 工具名 (函数名)
    description: str                 # 工具描述 (LLM 会读到)
    func: Callable                   # 实际执行函数
    parameters: dict[str, Any]       # JSON Schema 参数定义
    dangerous: bool = False          # 是否需要用户确认
    is_async: bool = False           # 是否异步

    def to_llm_format(self) -> dict:
        """生成给 LLM 看的 tools 定义"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.parameters,
                    "required": list(self.parameters.keys()),
                },
            },
        }

    def to_langchain_tool(self):
        """
        转换为 LangChain StructuredTool

        用于 LangChain Agent 的工具集成。
        如果 langchain 不可用，返回 None。
        """
        try:
            from langchain_core.tools import StructuredTool
            from pydantic import BaseModel, create_model, Field

            # 动态创建 Pydantic 模型作为工具参数 Schema
            fields: dict[str, Any] = {}
            sig = inspect.signature(self.func)
            hints = get_type_hints(self.func)

            for param_name, param in sig.parameters.items():
                if param_name in ("self", "cls"):
                    continue
                param_type = hints.get(param_name, str)
                default = ... if param.default is inspect.Parameter.empty else param.default
                fields[param_name] = (param_type, Field(default=default))

            # 如果没有参数，用空模型
            if fields:
                ArgsSchema = create_model(f"{self.name}_args", **fields)
            else:
                ArgsSchema = create_model(f"{self.name}_args")

            # 包装函数使其返回字符串（LangChain 要求）
            def _wrapped(**kwargs) -> str:
                result = self.func(**kwargs)
                if isinstance(result, str):
                    return result
                return json.dumps(result, ensure_ascii=False)

            return StructuredTool(
                name=self.name,
                description=self.description,
                func=_wrapped,
                args_schema=ArgsSchema,
            )

        except ImportError:
            logger.warning(
                "langchain 未安装，to_langchain_tool() 不可用。"
                "请运行: pip install langchain"
            )
            return None
        except Exception as e:
            logger.warning(f"创建 LangChain Tool '{self.name}' 失败: {e}")
            return None

    def call(self, **kwargs) -> dict:
        """执行工具"""
        try:
            result = self.func(**kwargs)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def call_async(self, **kwargs) -> dict:
        """异步执行工具"""
        try:
            if asyncio.iscoroutinefunction(self.func):
                result = await self.func(**kwargs)
            else:
                result = self.func(**kwargs)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ============================================================
# 3. @tool 装饰器
# ============================================================

def tool(
    description: str = "",
    dangerous: bool = False,
    name: str = "",
) -> Callable:
    """
    工具注册装饰器

    Args:
        description: 工具描述，告诉 LLM 这个工具是干什么的
        dangerous: 是否危险操作 (需要用户确认)
        name: 自定义工具名 (默认用函数名)

    用法:
        @tool(description="在互联网上搜索内容")
        def web_search(query: str, num_results: int = 5) -> str:
            ...
    """
    def decorator(func: Callable) -> Tool:
        hints = get_type_hints(func)
        sig = inspect.signature(func)

        parameters = {}
        for param_name, param in sig.parameters.items():
            if param_name in ("self", "cls"):
                continue
            param_type = hints.get(param_name, str)
            param_schema = python_type_to_json_type(param_type)
            parameters[param_name] = param_schema

        return Tool(
            name=name or func.__name__,
            description=description or (func.__doc__ or "").strip().split("\n")[0],
            func=func,
            parameters=parameters,
            dangerous=dangerous,
            is_async=inspect.iscoroutinefunction(func),
        )

    return decorator


# ============================================================
# 4. ToolRegistry - 工具注册中心
# ============================================================

class ToolRegistry:
    """管理所有工具的注册、查询、执行"""

    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool):
        """注册一个工具"""
        self._tools[tool.name] = tool

    def register_func(
        self,
        func: Callable,
        description: str = "",
        dangerous: bool = False,
        name: str = "",
    ):
        """直接注册一个函数为工具"""
        t = tool(description=description, dangerous=dangerous, name=name)(func)
        self.register(t)

    def unregister(self, name: str):
        """移除一个工具"""
        self._tools.pop(name, None)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def list_all(self) -> list[Tool]:
        return list(self._tools.values())

    def list_safe(self) -> list[Tool]:
        """只列出非危险工具"""
        return [t for t in self._tools.values() if not t.dangerous]

    def to_llm_format(self, only_safe: bool = False) -> list[dict]:
        """生成所有工具的 LLM 格式定义"""
        tools = self.list_safe() if only_safe else self.list_all()
        return [t.to_llm_format() for t in tools]

    def to_langchain_tools(self) -> list:
        """将所有工具转为 LangChain StructuredTool 列表"""
        lc_tools = []
        for t in self.list_all():
            lc_tool = t.to_langchain_tool()
            if lc_tool:
                lc_tools.append(lc_tool)
        return lc_tools

    def execute(self, name: str, **kwargs) -> dict:
        """执行指定工具"""
        tool = self.get(name)
        if not tool:
            return {"success": False, "error": f"工具 '{name}' 未注册"}
        return tool.call(**kwargs)

    async def execute_async(self, name: str, **kwargs) -> dict:
        """异步执行指定工具"""
        tool = self.get(name)
        if not tool:
            return {"success": False, "error": f"工具 '{name}' 未注册"}
        return await tool.call_async(**kwargs)

    def __len__(self):
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def __repr__(self):
        names = ", ".join(self._tools.keys())
        return f"<ToolRegistry ({len(self)} tools): {names}>"


# ============================================================
# 5. 全局注册中心 (单例)
# ============================================================

_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    """获取全局工具注册中心单例"""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
    return _registry


# ============================================================
# 自测
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("工具系统 演示")
    print("=" * 60)

    @tool(description="在互联网上搜索内容，返回结果列表")
    def web_search(query: str, num_results: int = 5) -> str:
        return f"搜索 '{query}' 完成，找到 {num_results} 条结果"

    @tool(description="执行 Python 代码并返回结果", dangerous=True)
    def run_python(code: str) -> str:
        return f"代码执行完毕: {code[:30]}..."

    @tool(description="读取文件内容")
    def read_file(filepath: str) -> str:
        with open(filepath, encoding="utf-8") as f:
            return f.read()

    registry = get_registry()
    registry.register(web_search)
    registry.register(run_python)
    registry.register(read_file)

    print(registry)
    print()

    # 查看生成的 LLM 格式
    for t_def in registry.to_llm_format():
        print(f"  {t_def['function']['name']}: {t_def['function']['description']}")
        print(f"     参数: {json.dumps(t_def['function']['parameters'], ensure_ascii=False)}")
        print()

    # 测试 LangChain 工具转换
    lc_tools = registry.to_langchain_tools()
    if lc_tools:
        print(f"LangChain 工具转换成功: {len(lc_tools)} 个")
        for t in lc_tools:
            print(f"  - {t.name}: {t.description}")
    else:
        print("LangChain 工具转换不可用（需要 pip install langchain）")

    # 执行工具
    result = registry.execute("web_search", query="Python Agent", num_results=3)
    print(f"\n执行 web_search: {result}")

    print("\n工具系统正常工作!")
