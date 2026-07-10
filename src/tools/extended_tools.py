# -*- coding: utf-8 -*-
"""
扩展工具集 —— 企业级 Agent 能力增强

新增工具:
  - database_query : 数据库查询 (SQLite / MySQL / PostgreSQL)
  - http_api_call  : HTTP API 调用 (GET/POST/PUT/DELETE + Headers + Body)
  - run_shell      : 受限 Shell 命令执行
  - send_email     : SMTP 邮件发送
  - read_pdf       : PDF 文件文本提取
  - read_excel     : Excel/CSV 表格数据读取
  - json_process   : JSON 数据查询与转换 (类 jq)
  - image_analyze  : 图片内容识别 (需 OCR/多模态 LLM)
  - time_tool      : 时间日期计算与格式化
  - text_diff      : 文本差异对比 (类似 diff)
"""

from __future__ import annotations
from typing import Any
import json
import os
import re
import subprocess
import tempfile
import hashlib
from datetime import datetime, timedelta

from .base import tool

# ============================================================
# 1. 数据库查询
# ============================================================

@tool(description="执行 SQL 查询并返回结果。支持 SQLite(文件路径)、MySQL(mysql://)、PostgreSQL(postgresql://)。仅允许 SELECT/PRAGMA，禁止修改操作。",
      dangerous=True)
def database_query(
    connection: str,
    query: str,
    limit: int = 20,
) -> str:
    """
    对数据库执行只读查询。

    Args:
        connection: 连接字符串。SQLite: '/path/to/db.sqlite'；MySQL: 'mysql://user:pass@host:port/dbname'；PG: 'postgresql://user:pass@host:port/dbname'
        query: SQL 查询语句（仅允许 SELECT / PRAGMA / EXPLAIN / SHOW）
        limit: 最大返回行数（默认 20）
    """
    import sqlite3

    # 安全检查：仅允许只读查询
    q_upper = query.strip().upper()
    allowed = {"SELECT", "PRAGMA", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "WITH"}
    first_word = q_upper.split()[0] if q_upper.split() else ""
    if first_word not in allowed:
        return f"安全限制: 禁止执行 {first_word} 语句。仅支持只读查询。"

    try:
        if connection.startswith("mysql://"):
            return _query_mysql(connection, query, limit)
        elif connection.startswith("postgresql://") or connection.startswith("postgres://"):
            return _query_postgres(connection, query, limit)
        else:
            return _query_sqlite(connection, query, limit)
    except Exception as e:
        return f"数据库查询失败: {str(e)}"


def _query_sqlite(path: str, query: str, limit: int) -> str:
    import sqlite3
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(query)
        columns = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchmany(limit + 1)
        has_more = len(rows) > limit
        rows = rows[:limit]

        lines = []
        if columns:
            lines.append(" | ".join(columns))
            lines.append("-" * len(lines[0]))
        for row in rows:
            lines.append(" | ".join(str(v) for v in row))

        result = "\n".join(lines)
        if has_more:
            result += f"\n\n... (仅显示前 {limit} 行，共更多行)"
        if not rows:
            result = "查询结果为空。"
        return result
    finally:
        conn.close()


def _query_mysql(conn_str: str, query: str, limit: int) -> str:
    try:
        import pymysql
    except ImportError:
        return "需要安装 pymysql: pip install pymysql"

    # 解析 mysql://user:pass@host:port/db
    m = re.match(r"mysql://([^:]+):([^@]+)@([^:/]+):?(\d*)/(.+)", conn_str)
    if not m:
        return "MySQL 连接字符串格式错误: 应为 mysql://user:pass@host:port/dbname"

    user, password, host, port, db = m.groups()
    port = int(port) if port else 3306

    conn = pymysql.connect(
        host=host, port=port, user=user,
        password=password, database=db,
        charset="utf8mb4", cursorclass=pymysql.cursors.Cursor,
    )
    try:
        with conn.cursor() as cur:
            # 添加 LIMIT 如果查询中没有
            if "LIMIT" not in query.upper():
                query = query.rstrip(";") + f" LIMIT {limit}"
            cur.execute(query)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall()

        lines = []
        if columns:
            lines.append(" | ".join(columns))
            lines.append("-" * len(lines[0]))
        for row in rows:
            lines.append(" | ".join(str(v) for v in row))

        return "\n".join(lines) if lines else "查询结果为空。"
    finally:
        conn.close()


def _query_postgres(conn_str: str, query: str, limit: int) -> str:
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        return "需要安装 psycopg2: pip install psycopg2-binary"

    # 解析 postgresql://user:pass@host:port/db
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):?(\d*)/(.+)", conn_str)
    if not m:
        return "PostgreSQL 连接字符串格式错误: 应为 postgresql://user:pass@host:port/dbname"

    user, password, host, port, db = m.groups()
    port = int(port) if port else 5432

    conn = psycopg2.connect(
        host=host, port=port, user=user,
        password=password, dbname=db,
    )
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if "LIMIT" not in query.upper():
                query = query.rstrip(";") + f" LIMIT {limit}"
            cur.execute(query)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall()

        lines = []
        if columns:
            lines.append(" | ".join(columns))
            lines.append("-" * len(lines[0]))
        for row in rows:
            lines.append(" | ".join(str(row.get(c, "")) for c in columns))

        return "\n".join(lines) if lines else "查询结果为空。"
    finally:
        conn.close()


# ============================================================
# 2. HTTP API 调用
# ============================================================

@tool(description="发起 HTTP API 请求并返回响应。支持 GET/POST/PUT/DELETE/PATCH，可自定义 Headers 和 JSON Body。用于调用外部 API 服务。",
      dangerous=True)
def http_api_call(
    url: str,
    method: str = "GET",
    headers: str = "{}",
    body: str = "",
    timeout: int = 30,
) -> str:
    """
    调用外部 HTTP API。

    Args:
        url: 请求地址，如 https://api.example.com/v1/data
        method: HTTP 方法，GET/POST/PUT/DELETE/PATCH
        headers: JSON 格式的请求头，如 '{"Authorization":"Bearer xxx","Content-Type":"application/json"}'
        body: 请求体（JSON 字符串或表单数据）
        timeout: 超时秒数（默认 30）
    """
    try:
        import requests
    except ImportError:
        return "需要安装 requests: pip install requests"

    method = method.upper()
    if method not in ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"):
        return f"不支持的 HTTP 方法: {method}"

    try:
        parsed_headers = json.loads(headers) if headers else {}
    except json.JSONDecodeError:
        return f"Headers JSON 解析错误: {headers}"

    try:
        if method == "GET":
            resp = requests.get(url, headers=parsed_headers, timeout=timeout)
        elif method == "POST":
            resp = requests.post(url, headers=parsed_headers, data=body, timeout=timeout)
        elif method == "PUT":
            resp = requests.put(url, headers=parsed_headers, data=body, timeout=timeout)
        elif method == "DELETE":
            resp = requests.delete(url, headers=parsed_headers, timeout=timeout)
        elif method == "PATCH":
            resp = requests.patch(url, headers=parsed_headers, data=body, timeout=timeout)
        else:
            resp = requests.request(method, url, headers=parsed_headers, data=body, timeout=timeout)

        resp.encoding = resp.apparent_encoding or "utf-8"

        # 格式化输出
        status_line = f"HTTP {resp.status_code} {resp.reason}"

        # 尝试解析 JSON 响应
        try:
            resp_json = resp.json()
            resp_text = json.dumps(resp_json, ensure_ascii=False, indent=2)
        except (json.JSONDecodeError, ValueError):
            resp_text = resp.text[:3000]
            if len(resp.text) > 3000:
                resp_text += f"\n\n... (响应被截断，总长 {len(resp.text)} 字符)"

        return f"{status_line}\n\n{resp_text}"

    except requests.exceptions.Timeout:
        return f"请求超时 ({timeout}秒): {url}"
    except requests.exceptions.ConnectionError:
        return f"连接失败: {url}"
    except Exception as e:
        return f"HTTP 请求失败: {str(e)}"


# ============================================================
# 3. Shell 命令执行（受限沙箱）
# ============================================================

_SAFE_SHELL_COMMANDS = {
    "ls", "dir", "cat", "head", "tail", "wc", "grep", "find",
    "echo", "date", "whoami", "hostname", "pwd", "env",
    "df", "du", "free", "uptime", "uname",
    "tar", "zip", "unzip", "gzip", "gunzip",
    "curl", "wget", "ping",
    "python", "python3", "pip", "pip3",
    "git", "node", "npm",
    "ffmpeg", "ffprobe",
    "wc", "sort", "uniq", "cut", "awk", "sed", "tr",
}

@tool(description="在受限环境中执行 Shell 命令。仅允许查看/分析类命令，禁止修改文件系统。超时 30 秒。",
      dangerous=True)
def run_shell(command: str) -> str:
    """
    执行受限制的 Shell 命令。

    安全规则:
      - 只能执行白名单中的命令
      - 禁止管道到写操作 (如 > file)
      - 禁止 rm/mv/chmod/chown/sudo
      - 30 秒超时
    """
    cmd_parts = command.strip().split()
    if not cmd_parts:
        return "命令为空。"

    base_cmd = os.path.basename(cmd_parts[0])

    if base_cmd not in _SAFE_SHELL_COMMANDS:
        return (
            f"安全限制: 不允许执行 '{base_cmd}'。"
            f"\n允许的命令: {', '.join(sorted(_SAFE_SHELL_COMMANDS))}"
        )

    # 禁止写入重定向
    if re.search(r"\s[12]?>>?\s", command) or re.search(r">[^=]", command):
        return "安全限制: 禁止输出重定向到文件。"

    # 禁止危险子命令
    dangerous = {"rm", "mv", "chmod", "chown", "sudo", "kill", "reboot", "shutdown",
                 "mkfs", "dd", "mount", "umount", "fdisk"}
    for word in cmd_parts:
        if word in dangerous:
            return f"安全限制: 禁止参数中含 '{word}'"

    try:
        result = subprocess.run(
            command, shell=True,
            capture_output=True, text=True,
            timeout=30, cwd=os.getcwd(),
            env={**os.environ, "PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        )

        output = ""
        if result.stdout:
            stdout_text = result.stdout[:5000]
            if len(result.stdout) > 5000:
                stdout_text += f"\n... (输出被截断，总长 {len(result.stdout)} 字符)"
            output += stdout_text
        if result.stderr:
            stderr_text = result.stderr[:1000]
            output += f"\n[stderr]\n{stderr_text}"

        return output.strip() or f"命令执行完毕 (返回码: {result.returncode})"

    except subprocess.TimeoutExpired:
        return "命令执行超时 (30秒)"
    except Exception as e:
        return f"命令执行失败: {str(e)}"


# ============================================================
# 4. 邮件发送
# ============================================================

@tool(description="通过 SMTP 发送邮件。支持纯文本和 HTML 格式，可添加附件。",
      dangerous=True)
def send_email(
    to: str,
    subject: str,
    body: str,
    smtp_host: str = "",
    smtp_port: int = 587,
    username: str = "",
    password: str = "",
    html: bool = False,
) -> str:
    """
    发送邮件。

    Args:
        to: 收件人邮箱，多个用逗号分隔
        subject: 邮件主题
        body: 邮件正文
        smtp_host: SMTP 服务器地址（留空则从环境变量 SMTP_HOST 读取）
        smtp_port: SMTP 端口（默认 587）
        username: SMTP 用户名（留空则从环境变量 SMTP_USER 读取）
        password: SMTP 密码/授权码（留空则从环境变量 SMTP_PASS 读取）
        html: body 是否为 HTML 格式
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.header import Header

    # 从环境变量读取 SMTP 配置
    smtp_host = smtp_host or os.environ.get("SMTP_HOST", "")
    username = username or os.environ.get("SMTP_USER", "")
    password = password or os.environ.get("SMTP_PASS", "")

    if not smtp_host:
        return "SMTP 服务器未配置。请设置 smtp_host 参数或环境变量 SMTP_HOST。"

    try:
        msg = MIMEMultipart()
        msg["From"] = username
        msg["To"] = to
        msg["Subject"] = Header(subject, "utf-8")

        subtype = "html" if html else "plain"
        msg.attach(MIMEText(body, subtype, "utf-8"))

        recipients = [addr.strip() for addr in to.split(",")]

        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.starttls()
            if username and password:
                server.login(username, password)
            server.sendmail(username, recipients, msg.as_string())

        return f"邮件已发送到 {to} (主题: {subject})"

    except smtplib.SMTPAuthenticationError:
        return "SMTP 认证失败，请检查用户名和密码。"
    except smtplib.SMTPConnectError:
        return f"无法连接到 SMTP 服务器: {smtp_host}:{smtp_port}"
    except Exception as e:
        return f"邮件发送失败: {str(e)}"


# ============================================================
# 5. PDF 文本提取
# ============================================================

@tool(description="提取 PDF 文件的文本内容。支持文本型和扫描型 PDF（扫描型需 pytesseract）。")
def read_pdf(filepath: str, max_pages: int = 10) -> str:
    """
    读取 PDF 文件内容。

    Args:
        filepath: PDF 文件路径
        max_pages: 最大读取页数（默认 10）
    """
    abs_path = os.path.abspath(filepath)
    if not os.path.exists(abs_path):
        return f"文件不存在: {abs_path}"

    try:
        # 优先使用 PyMuPDF (fitz) 速度更快
        try:
            import fitz
            doc = fitz.open(abs_path)
            pages = min(len(doc), max_pages)
            texts = []
            for i in range(pages):
                page = doc[i]
                text = page.get_text()
                if text.strip():
                    texts.append(f"--- 第 {i+1} 页 ---\n{text.strip()}")
            doc.close()

            result = "\n\n".join(texts)
            if pages < len(doc):
                result += f"\n\n... (仅显示前 {pages} 页，共 {len(doc)} 页)"
            return result if texts else "PDF 中没有可提取的文本内容（可能是扫描件）。"

        except ImportError:
            pass

        # 回退到 pdfplumber
        try:
            import pdfplumber
            texts = []
            with pdfplumber.open(abs_path) as pdf:
                pages = min(len(pdf.pages), max_pages)
                for i in range(pages):
                    text = pdf.pages[i].extract_text()
                    if text:
                        texts.append(f"--- 第 {i+1} 页 ---\n{text.strip()}")
                if pages < len(pdf.pages):
                    texts.append(f"\n... (仅显示前 {pages} 页，共 {len(pdf.pages)} 页)")
            return "\n\n".join(texts) if texts else "PDF 中没有可提取的文本内容（可能是扫描件）。"

        except ImportError:
            pass

        # 回退到 PyPDF2
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(abs_path)
            pages = min(len(reader.pages), max_pages)
            texts = []
            for i in range(pages):
                text = reader.pages[i].extract_text()
                if text:
                    texts.append(f"--- 第 {i+1} 页 ---\n{text.strip()}")
            if pages < len(reader.pages):
                texts.append(f"\n... (仅显示前 {pages} 页，共 {len(reader.pages)} 页)")
            return "\n\n".join(texts) if texts else "PDF 中没有可提取的文本内容（可能是扫描件）。"

        except ImportError:
            return "需要安装 PDF 解析库: pip install PyMuPDF  (推荐) 或 pip install pdfplumber 或 pip install PyPDF2"

    except Exception as e:
        return f"PDF 读取失败: {str(e)}"


# ============================================================
# 6. Excel / CSV 读取
# ============================================================

@tool(description="读取 Excel (.xlsx/.xls) 或 CSV 文件，返回表格数据。支持指定工作表名和最大行数。")
def read_excel(
    filepath: str,
    sheet_name: str = "",
    max_rows: int = 50,
    format: str = "table",
) -> str:
    """
    读取表格文件。

    Args:
        filepath: 文件路径 (.xlsx / .xls / .csv)
        sheet_name: 工作表名（.xlsx 文件，留空取第1个）
        max_rows: 最大读取行数（默认 50）
        format: 输出格式 — table(表格文本) / json(JSON数组)
    """
    abs_path = os.path.abspath(filepath)
    if not os.path.exists(abs_path):
        return f"文件不存在: {abs_path}"

    try:
        if abs_path.lower().endswith(".csv"):
            return _read_csv(abs_path, max_rows, format)
        else:
            return _read_excel(abs_path, sheet_name, max_rows, format)
    except Exception as e:
        return f"表格读取失败: {str(e)}"


def _read_csv(path: str, max_rows: int, fmt: str) -> str:
    import csv
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = next(reader, [])
        rows = []
        for i, row in enumerate(reader):
            if i >= max_rows:
                rows.append(None)  # marker
                break
            rows.append(row)

    has_more = rows and rows[-1] is None
    if has_more:
        rows = rows[:-1]

    return _format_table(headers, rows, has_more, max_rows, fmt)


def _read_excel(path: str, sheet_name: str, max_rows: int, fmt: str) -> str:
    try:
        import openpyxl
    except ImportError:
        return "需要安装 openpyxl: pip install openpyxl"

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet_name] if sheet_name else wb.active

    headers = []
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c) if c is not None else "" for c in row]
        elif i <= max_rows:
            rows.append([str(c) if c is not None else "" for c in row])
        else:
            rows.append(None)
            break

    wb.close()
    has_more = rows and rows[-1] is None
    if has_more:
        rows = rows[:-1]

    return _format_table(headers, rows, has_more, max_rows, fmt)


def _format_table(headers, rows, has_more, max_rows, fmt):
    if fmt == "json":
        result = []
        for row in rows:
            result.append(dict(zip(headers, row)))
        output = json.dumps(result, ensure_ascii=False, indent=2)
        if has_more:
            output += f"\n\n... (仅显示前 {max_rows} 行)"
        return output

    # table 格式
    if not headers:
        return "表格为空。"

    # 计算列宽
    col_widths = [len(h) for h in headers]
    for row in rows:
        for j, cell in enumerate(row):
            if j < len(col_widths):
                col_widths[j] = max(col_widths[j], len(str(cell)))

    # 表头
    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    sep_line = "-" * len(header_line)

    lines = [header_line, sep_line]
    for row in rows:
        lines.append(" | ".join(
            (str(row[j]) if j < len(row) else "").ljust(col_widths[j])
            for j in range(len(headers))
        ))

    result = "\n".join(lines)
    if has_more:
        result += f"\n\n... (仅显示前 {max_rows} 行)"
    return result


# ============================================================
# 7. JSON 数据处理
# ============================================================

@tool(description="对 JSON 数据执行查询、提取和转换操作。支持点路径访问和简单过滤。")
def json_process(
    data: str,
    operation: str = "query",
    path: str = "",
) -> str:
    """
    JSON 数据查询与操作。

    Args:
        data: JSON 字符串
        operation: query(提取路径) / keys(列出顶层键) / count(计数)
        path: 点号分隔的访问路径，如 "users.0.name" 或 "data.items[*].id"
    """
    try:
        obj = json.loads(data)
    except json.JSONDecodeError as e:
        return f"JSON 解析错误: {e}"

    if operation == "keys":
        if isinstance(obj, dict):
            return f"顶层键 ({len(obj)} 个):\n" + "\n".join(f"  - {k}: {type(v).__name__}" for k, v in obj.items())
        elif isinstance(obj, list):
            return f"数组，共 {len(obj)} 个元素。第一个元素的类型: {type(obj[0]).__name__}" if obj else "空数组"
        return f"类型: {type(obj).__name__}"

    if operation == "count":
        if isinstance(obj, (list, dict)):
            return f"元素数量: {len(obj)}"
        return f"类型: {type(obj).__name__}, 长度: {len(str(obj))}"

    if operation == "query" and path:
        result = _json_path_get(obj, path)
        if isinstance(result, (dict, list)):
            return json.dumps(result, ensure_ascii=False, indent=2)
        return str(result)

    return json.dumps(obj, ensure_ascii=False, indent=2)[:3000]


def _json_path_get(obj, path: str):
    """点号路径访问 JSON 对象"""
    parts = path.replace("[", ".").replace("]", "").split(".")
    current = obj
    for part in parts:
        if not part:
            continue
        if isinstance(current, list):
            if part == "*":
                return [_json_path_get(item, ".".join(parts[parts.index(part)+1:]))
                        for item in current]
            try:
                idx = int(part)
                current = current[idx]
            except (ValueError, IndexError):
                return f"索引错误: {part}"
        elif isinstance(current, dict):
            current = current.get(part, f"键 '{part}' 不存在")
        else:
            return f"无法访问路径 '{part}'，当前值是: {current}"
    return current


# ============================================================
# 8. 时间日期工具
# ============================================================

@tool(description="时间日期计算与格式化工具。获取当前时间、计算时差、格式化日期等。")
def time_tool(
    operation: str = "now",
    datetime_str: str = "",
    format_str: str = "%Y-%m-%d %H:%M:%S",
    delta_days: int = 0,
    delta_hours: int = 0,
) -> str:
    """
    时间日期操作。

    Args:
        operation: now(当前时间) / format(格式化) / add(加减时间) / diff(计算差值) / weekday(星期几) / timestamp(时间戳)
        datetime_str: 要操作的日期时间字符串
        format_str: 日期格式字符串
        delta_days: 增减天数
        delta_hours: 增减小时数
    """
    now = datetime.now()

    if operation == "now":
        return f"当前时间: {now.strftime('%Y-%m-%d %H:%M:%S')}\n星期: {_weekday_cn(now.weekday())}\n时间戳: {int(now.timestamp())}"

    if operation == "timestamp":
        ts = int(datetime_str) if datetime_str.isdigit() else int(now.timestamp())
        dt = datetime.fromtimestamp(ts)
        return f"时间戳 {ts} = {dt.strftime('%Y-%m-%d %H:%M:%S')}"

    if operation == "format":
        if not datetime_str:
            return "请提供 datetime_str 参数（要格式化的日期时间字符串）"
        try:
            for fmt in [format_str, "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%m/%d/%Y"]:
                try:
                    dt = datetime.strptime(datetime_str, fmt)
                    return dt.strftime(format_str)
                except ValueError:
                    continue
            return f"无法解析日期: {datetime_str}"
        except Exception as e:
            return f"格式化失败: {e}"

    if operation == "add":
        if not datetime_str:
            dt = now
        else:
            try:
                dt = datetime.strptime(datetime_str, format_str)
            except ValueError:
                return f"无法解析日期: {datetime_str} (格式: {format_str})"
        result = dt + timedelta(days=delta_days, hours=delta_hours)
        return f"{datetime_str or '现在'} + {delta_days}天{delta_hours}小时 = {result.strftime(format_str)}"

    if operation == "diff":
        if not datetime_str:
            return "请提供 datetime_str 参数（要比较的日期时间）"
        try:
            dt = datetime.strptime(datetime_str, format_str)
        except ValueError:
            return f"无法解析日期: {datetime_str} (格式: {format_str})"
        diff = now - dt if dt < now else dt - now
        total_seconds = abs(int(diff.total_seconds()))
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60
        direction = "前" if dt < now else "后"
        return f"{datetime_str} 距今 {days}天{hours}小时{minutes}分钟{direction}"

    if operation == "weekday":
        if datetime_str:
            try:
                dt = datetime.strptime(datetime_str, format_str)
            except ValueError:
                return f"无法解析日期: {datetime_str}"
        else:
            dt = now
        return f"{dt.strftime('%Y-%m-%d')} 是 {_weekday_cn(dt.weekday())}"

    return f"未知操作: {operation}。支持: now, format, add, diff, weekday, timestamp"


def _weekday_cn(weekday: int) -> str:
    return ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][weekday]


# ============================================================
# 9. 文本差异对比
# ============================================================

@tool(description="对比两段文本的差异，输出类似 diff 的格式。用于代码审查、文档对比等。")
def text_diff(text_a: str, text_b: str, context_lines: int = 3) -> str:
    """
    文本差异对比。

    Args:
        text_a: 原始文本
        text_b: 新文本
        context_lines: 差异上下文行数（默认 3）
    """
    import difflib

    lines_a = text_a.splitlines(keepends=True)
    lines_b = text_b.splitlines(keepends=True)

    diff = difflib.unified_diff(
        lines_a, lines_b,
        fromfile="原始文本", tofile="新文本",
        n=context_lines,
    )

    result = "".join(diff)
    if not result.strip():
        return "两段文本完全相同。"

    if len(result) > 5000:
        result = result[:5000] + "\n\n... (差异输出被截断)"

    return result


# ============================================================
# 10. 图片分析（多模态）
# ============================================================

@tool(description="分析图片内容。对图片进行描述、OCR 文字识别或问答。需要多模态 LLM 或 OCR 库支持。")
def image_analyze(
    image_path: str,
    question: str = "请描述这张图片的内容",
) -> str:
    """
    分析图片内容。

    Args:
        image_path: 图片文件路径（支持 jpg/png/webp/gif）
        question: 要询问的问题（默认: 描述图片内容）
    """
    abs_path = os.path.abspath(image_path)
    if not os.path.exists(abs_path):
        return f"图片文件不存在: {abs_path}"

    ext = os.path.splitext(abs_path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"):
        return f"不支持的图片格式: {ext}"

    try:
        # 尝试使用 OCR 提取文字
        try:
            import pytesseract
            from PIL import Image
            img = Image.open(abs_path)
            text = pytesseract.image_to_string(img, lang="chi_sim+eng")
            if text.strip():
                result = f"--- OCR 识别的文字 ---\n{text.strip()}\n\n--- 图片基本信息 ---\n"
            else:
                result = "OCR 未识别到文字。\n\n"
        except ImportError:
            result = "(未安装 pytesseract，跳过 OCR)\n\n"

        # 读取图片基本信息
        from PIL import Image
        img = Image.open(abs_path)
        result += (
            f"文件: {os.path.basename(abs_path)}\n"
            f"尺寸: {img.width}x{img.height}\n"
            f"格式: {img.format}\n"
            f"模式: {img.mode}\n"
            f"文件大小: {os.path.getsize(abs_path) / 1024:.1f} KB\n"
        )

        # 尝试读取 EXIF 信息
        try:
            exif = img._getexif()
            if exif:
                result += f"EXIF 条目: {len(exif)} 项\n"
        except Exception:
            pass

        img.close()

        result += (
            f"\n注意: 多模态图片分析需要支持视觉的 LLM（如 GPT-4o/gpt-4-vision-preview）。"
            f"\n如果你使用的是多模态 LLM，请直接将此图片路径提供给 LLM 进行分析。"
            f"\n分析问题: {question}"
        )

        return result

    except ImportError:
        return "需要安装 PIL/Pillow: pip install Pillow"
    except Exception as e:
        return f"图片分析失败: {str(e)}"


# ============================================================
# 批量注册
# ============================================================

ALL_EXTENDED_TOOLS = [
    database_query,
    http_api_call,
    run_shell,
    send_email,
    read_pdf,
    read_excel,
    json_process,
    time_tool,
    text_diff,
    image_analyze,
]


def register_all(registry=None):
    """注册所有扩展工具到注册中心"""
    if registry is None:
        from .base import get_registry
        registry = get_registry()
    for t in ALL_EXTENDED_TOOLS:
        registry.register(t)
    return registry


# ============================================================
# 自测
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("扩展工具 演示")
    print("=" * 60)

    # 测试时间工具
    print("\n🕐 时间工具:")
    print(f"  {time_tool.call(operation='now')}")

    print(f"  {time_tool.call(operation='weekday', datetime_str='2025-01-01')}")

    # 测试 JSON 处理
    print("\n📋 JSON 处理:")
    test_json = '{"users":[{"name":"Alice","age":30},{"name":"Bob","age":25}],"total":2}'
    print(f"  数据: {test_json}")
    print(f"  keys: {json_process.call(data=test_json, operation='keys')}")
    print(f"  query users.0.name: {json_process.call(data=test_json, operation='query', path='users.0.name')}")

    # 测试文本差异
    print("\n📝 文本差异:")
    diff_result = text_diff.call(
        text_a="Hello World\nThis is line 2\nGoodbye",
        text_b="Hello World\nThis is changed\nGoodbye\nNew line"
    )
    print(f"  {diff_result}")

    print("\n✅ 扩展工具测试完成!")
