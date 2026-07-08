# -*- coding: utf-8 -*-
"""工具系统单元测试 —— 装饰器 / Tool / ToolRegistry / 内置工具"""

from __future__ import annotations
import pytest
from src.tools.base import (
    Tool, tool, ToolRegistry, get_registry,
    python_type_to_json_type,
)
from src.tools.builtin_tools import (
    web_search, fetch_url, read_file, write_file,
    run_python, calculator, ALL_BUILTIN_TOOLS, register_all,
)


# ============================================================
# python_type_to_json_type
# ============================================================

class TestTypeMapping:
    def test_str(self):
        assert python_type_to_json_type(str) == {"type": "string"}

    def test_int(self):
        assert python_type_to_json_type(int) == {"type": "integer"}

    def test_float(self):
        assert python_type_to_json_type(float) == {"type": "number"}

    def test_bool(self):
        assert python_type_to_json_type(bool) == {"type": "boolean"}

    def test_list(self):
        assert python_type_to_json_type(list) == {
            "type": "array", "items": {"type": "string"}
        }

    def test_dict(self):
        assert python_type_to_json_type(dict) == {"type": "object"}

    def test_unknown(self):
        class Custom: pass
        result = python_type_to_json_type(Custom)
        assert result == {"type": "string"}


# ============================================================
# @tool 装饰器
# ============================================================

class TestToolDecorator:
    def test_basic_decorator(self):
        @tool(description="搜索互联网")
        def my_search(query: str, num: int = 5) -> str:
            return f"搜索: {query}"

        assert isinstance(my_search, Tool)
        assert my_search.name == "my_search"
        assert my_search.description == "搜索互联网"
        assert "query" in my_search.parameters
        assert "num" in my_search.parameters
        assert my_search.dangerous is False

    def test_dangerous_tool(self):
        @tool(description="删除文件", dangerous=True)
        def delete_stuff(path: str) -> str:
            return "done"

        assert delete_stuff.dangerous is True

    def test_custom_name(self):
        @tool(description="计算", name="calc")
        def compute(expr: str) -> str:
            return expr

        assert compute.name == "calc"

    def test_description_from_docstring(self):
        @tool()
        def my_fn(x: int) -> int:
            """计算平方值并返回。"""
            return x * x

        assert "计算平方" in my_fn.description

    def test_skips_self_param(self):
        class Foo:
            @tool(description="do thing")
            def bar(self, x: int) -> str:
                return str(x)

        tool_instance = Foo.bar
        assert isinstance(tool_instance, Tool)
        assert "self" not in tool_instance.parameters


# ============================================================
# Tool.call / Tool.call_async
# ============================================================

class TestToolExecution:
    def test_call_success(self):
        @tool(description="加法")
        def add(a: int, b: int) -> int:
            return a + b

        result = add.call(a=3, b=4)
        assert result["success"] is True
        assert result["result"] == 7

    def test_call_failure(self):
        @tool(description="会炸")
        def crash() -> str:
            raise ValueError("故意的错误")

        result = crash.call()
        assert result["success"] is False
        assert "故意的错误" in result["error"]


# ============================================================
# Tool.to_llm_format
# ============================================================

class TestToolLLMFormat:
    def test_generates_correct_schema(self):
        @tool(description="搜索内容")
        def search(query: str, limit: int = 10) -> str:
            return query

        fmt = search.to_llm_format()
        assert fmt["type"] == "function"
        assert fmt["function"]["name"] == "search"
        assert fmt["function"]["description"] == "搜索内容"
        params = fmt["function"]["parameters"]
        assert params["type"] == "object"
        assert "query" in params["properties"]
        assert "limit" in params["properties"]
        assert "query" in params["required"]


# ============================================================
# Tool.to_langchain_tool
# ============================================================

class TestToolLangChain:
    def test_converts_to_structured_tool(self):
        @tool(description="计算两个数的和")
        def add(a: int, b: int) -> int:
            return a + b

        lc_tool = add.to_langchain_tool()
        assert lc_tool is not None
        assert lc_tool.name == "add"
        assert "计算" in lc_tool.description

        # 测试执行
        result = lc_tool.invoke({"a": 1, "b": 2})
        assert "3" in result


# ============================================================
# ToolRegistry
# ============================================================

class TestToolRegistry:
    def test_register_and_get(self, fresh_registry):
        @tool(description="测试")
        def test_fn(x: str) -> str:
            return x

        fresh_registry.register(test_fn)
        assert len(fresh_registry) == 1
        assert "test_fn" in fresh_registry
        t = fresh_registry.get("test_fn")
        assert t is not None
        assert t.name == "test_fn"

    def test_unregister(self, fresh_registry):
        @tool(description="x")
        def a():
            pass

        fresh_registry.register(a)
        assert len(fresh_registry) == 1
        fresh_registry.unregister("a")
        assert len(fresh_registry) == 0

    def test_list_all(self, fresh_registry):
        @tool(description="t1")
        def t1():
            pass

        @tool(description="t2")
        def t2():
            pass

        fresh_registry.register(t1)
        fresh_registry.register(t2)
        tools = fresh_registry.list_all()
        assert len(tools) == 2
        names = {t.name for t in tools}
        assert names == {"t1", "t2"}

    def test_list_safe(self, fresh_registry):
        @tool(description="安全")
        def safe_tool():
            pass

        @tool(description="危险", dangerous=True)
        def danger_tool():
            pass

        fresh_registry.register(safe_tool)
        fresh_registry.register(danger_tool)
        assert len(fresh_registry.list_all()) == 2
        assert len(fresh_registry.list_safe()) == 1
        assert fresh_registry.list_safe()[0].name == "safe_tool"

    def test_get_nonexistent(self, fresh_registry):
        assert fresh_registry.get("nonexistent") is None

    def test_execute_existing(self, fresh_registry):
        @tool(description="加倍")
        def double(x: int) -> int:
            return x * 2

        fresh_registry.register(double)
        r = fresh_registry.execute("double", x=5)
        assert r["success"] is True
        assert r["result"] == 10

    def test_execute_nonexistent(self, fresh_registry):
        r = fresh_registry.execute("ghost", x=1)
        assert r["success"] is False
        assert "未注册" in r["error"]

    def test_to_llm_format(self, fresh_registry):
        @tool(description="t1")
        def fn1():
            pass

        fresh_registry.register(fn1)
        fmt = fresh_registry.to_llm_format()
        assert len(fmt) == 1
        assert fmt[0]["function"]["name"] == "fn1"

    def test_to_llm_format_only_safe(self, fresh_registry):
        @tool(description="安全")
        def safe():
            pass

        @tool(description="危险", dangerous=True)
        def danger():
            pass

        fresh_registry.register(safe)
        fresh_registry.register(danger)
        assert len(fresh_registry.to_llm_format(only_safe=True)) == 1

    def test_to_langchain_tools(self, fresh_registry):
        @tool(description="加法")
        def add(a: int, b: int) -> int:
            return a + b

        fresh_registry.register(add)
        lc_tools = fresh_registry.to_langchain_tools()
        assert len(lc_tools) == 1
        assert lc_tools[0].name == "add"

    def test_register_func(self, fresh_registry):
        def my_fn(text: str) -> str:
            return text.upper()

        fresh_registry.register_func(my_fn, description="转大写", name="upper")
        assert "upper" in fresh_registry
        r = fresh_registry.execute("upper", text="hello")
        assert r["result"] == "HELLO"

    def test_len_and_contains(self, fresh_registry):
        @tool(description="x")
        def x():
            pass

        assert len(fresh_registry) == 0
        fresh_registry.register(x)
        assert len(fresh_registry) == 1
        assert "x" in fresh_registry
        assert "y" not in fresh_registry

    def test_repr(self, fresh_registry):
        @tool(description="x")
        def x():
            pass

        fresh_registry.register(x)
        r = repr(fresh_registry)
        assert "ToolRegistry" in r
        assert "x" in r


# ============================================================
# 全局单例 get_registry
# ============================================================

class TestGlobalRegistry:
    def test_is_singleton(self):
        r1 = get_registry()
        r2 = get_registry()
        assert r1 is r2


# ============================================================
# 内置工具测试
# ============================================================

class TestCalculator:
    def test_basic_arithmetic(self):
        r = calculator.call(expression="2 + 3 * 4")
        assert r["success"] is True
        assert "14" in r["result"]

    def test_math_functions(self):
        r = calculator.call(expression="sqrt(16) + pow(2, 3)")
        assert r["success"] is True
        assert "12" in r["result"]

    def test_invalid_expression(self):
        r = calculator.call(expression="2 // 0")
        # calculator 内部 catch 了 ZeroDivisionError，返回 "计算失败: ..."
        assert "计算失败" in r["result"] or r["success"] is False


class TestRunPython:
    def test_simple_math(self):
        r = run_python.call(code="print(1 + 2 + 3)")
        assert r["success"] is True
        assert "6" in r["result"]

    def test_loop(self):
        code = """
total = 0
for i in range(1, 6):
    total += i
print(total)
"""
        r = run_python.call(code=code)
        assert r["success"] is True
        assert "15" in r["result"]

    def test_blocks_import_os(self):
        r = run_python.call(code="import os; print(os.getcwd())")
        assert r["result"] is not None
        assert ("安全限制" in r["result"] or "不允许" in r["result"])

    def test_blocks_eval(self):
        r = run_python.call(code='eval("1+1")')
        assert "安全限制" in r["result"]


class TestReadFile:
    def test_reads_content(self, temp_file):
        r = read_file.call(filepath=temp_file)
        assert r["success"] is True
        assert "Hello, World!" in r["result"]

    def test_nonexistent_file(self):
        r = read_file.call(filepath="/nonexistent/file/xyz_12345.txt")
        # read_file 内部 catch 了 FileNotFoundError，返回 "读取失败: ..."
        assert "读取失败" in r["result"] or r["success"] is False


class TestWriteFile:
    def test_write_and_read(self, temp_dir):
        import os
        path = os.path.join(temp_dir, "output.txt")
        r = write_file.call(filepath=path, content="测试内容")
        assert r["success"] is True
        assert os.path.exists(path)
        with open(path, encoding="utf-8") as f:
            assert f.read() == "测试内容"


# ============================================================
# register_all
# ============================================================

class TestRegisterAll:
    def test_registers_all_six(self, fresh_registry):
        register_all(fresh_registry)
        assert len(fresh_registry) == 6
        expected = {"web_search", "fetch_url", "read_file", "write_file", 
                     "run_python", "calculator"}
        assert set(fresh_registry._tools.keys()) == expected

    def test_all_builtin_tools_are_tools(self):
        for t in ALL_BUILTIN_TOOLS:
            assert isinstance(t, Tool), f"{t} 不是 Tool 实例"
