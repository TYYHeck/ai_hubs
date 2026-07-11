# -*- coding: utf-8 -*-
"""
M5 冒烟测试 — 技能市场 / 数据集 / IDE（独立脚本，用系统 python 运行）

运行:
    cd ai_hubs
    python tests/smoke_m5.py

使用 FastAPI TestClient 启动 v4 后端（SQLite 临时库），以默认管理员登录，
覆盖三大模块的核心链路。
"""

import os
import sys
import tempfile

# 必须在导入 backend 之前设置数据库环境（config 在导入时加载）
_TMP_DB = os.path.join(tempfile.gettempdir(), "aihubs_m5_smoke.db")
if os.path.exists(_TMP_DB):
    os.remove(_TMP_DB)
os.environ["AIHUBS_DATABASE__FORCE_SQLITE"] = "true"
os.environ["AIHUBS_DATABASE__SQLITE_PATH"] = _TMP_DB

_PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJ not in sys.path:
    sys.path.insert(0, _PROJ)

from fastapi.testclient import TestClient
from backend.app.main import app

BASE = "/api/v1"
_failures = []


def check(cond, msg):
    if cond:
        print(f"  [PASS] {msg}")
    else:
        print(f"  [FAIL] {msg}")
        _failures.append(msg)


def main():
    print("=== M5 冒烟测试 ===")
    with TestClient(app) as client:
        # ── 登录（默认管理员）──
        r = client.post(f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"})
        check(r.status_code == 200, f"管理员登录 200 (got {r.status_code})")
        if r.status_code != 200:
            print(r.text)
            return
        token = r.json()["access_token"]
        H = {"Authorization": f"Bearer {token}"}

        # ════════ 技能市场 ════════
        print("\n-- 技能市场 --")
        r = client.post(f"{BASE}/skills", json={"name": "test_skill", "description": "smoke", "category": "test", "code": "print('hi')", "entry": "skill.py"}, headers=H)
        check(r.status_code == 201, f"创建自定义技能 201 (got {r.status_code})")
        sid = r.json().get("id")
        check(r.json().get("source") == "custom", "技能 source=custom")

        r = client.get(f"{BASE}/skills?source=custom", headers=H)
        check(r.status_code == 200 and any(s["id"] == sid for s in r.json()), "列表可检索到自建技能")

        r = client.put(f"{BASE}/skills/{sid}", json={"description": "updated"}, headers=H)
        check(r.status_code == 200 and r.json().get("description") == "updated", "更新技能 description")

        r = client.post(f"{BASE}/skills/{sid}/install", headers=H)
        check(r.status_code == 200 and r.json().get("is_installed") is True, "安装技能 is_installed=True")

        r = client.post(f"{BASE}/skills/{sid}/uninstall", headers=H)
        check(r.status_code == 200 and r.json().get("is_installed") is False, "卸载技能 is_installed=False")

        # GitHub 市场（无网络时返回 200 + error 字段，不报错）
        r = client.get(f"{BASE}/skills/market/github?q=ai%20agent", headers=H)
        check(r.status_code == 200 and "items" in r.json() and "error" in r.json(), "GitHub 市场检索 200 且结构正确")

        # 删除自定义技能
        r = client.delete(f"{BASE}/skills/{sid}", headers=H)
        check(r.status_code == 204, f"删除自定义技能 204 (got {r.status_code})")
        r = client.delete(f"{BASE}/skills/999999", headers=H)
        check(r.status_code == 404, "删除不存在技能 404")

        # ════════ 数据集 ════════
        print("\n-- 数据集 --")
        r = client.post(f"{BASE}/datasets", json={"name": "ds1", "description": "smoke ds", "category": "test", "schema": {"a": "int", "b": "str"}}, headers=H)
        check(r.status_code == 201, f"创建数据集 201 (got {r.status_code})")
        did = r.json().get("id")
        check(r.json().get("schema", {}).get("a") == "int", "数据集 schema 字段正确回传")

        # 单条记录
        r = client.post(f"{BASE}/datasets/{did}/records", json={"data": {"a": 1, "b": "x"}}, headers=H)
        check(r.status_code == 201, "新增记录 201")
        r = client.post(f"{BASE}/datasets/{did}/records", json={"data": {"a": 2, "b": "y"}}, headers=H)
        check(r.status_code == 201, "新增第二条记录 201")

        # 导入 JSON
        r = client.post(f"{BASE}/datasets/{did}/import", json={"format": "json", "content": '[{"a":3,"b":"z"},{"a":4,"b":"w"}]'}, headers=H)
        check(r.status_code == 200 and r.json().get("inserted") == 2, f"导入 JSON 成功 inserted=2 (got {r.json()})")

        # 导入 CSV
        r = client.post(f"{BASE}/datasets/{did}/import", json={"format": "csv", "content": "a,b\n5,p\n6,q"}, headers=H)
        check(r.status_code == 200 and r.json().get("inserted") == 2, "导入 CSV 成功 inserted=2")

        # 记录列表
        r = client.get(f"{BASE}/datasets/{did}/records?limit=100", headers=H)
        check(r.status_code == 200 and len(r.json()) == 6, f"记录列表包含 6 条 (got {len(r.json())})")

        # 导出 JSON
        r = client.get(f"{BASE}/datasets/{did}/export?format=json", headers=H)
        check(r.status_code == 200 and r.json().get("format") == "json" and len(r.json().get("content", "")) > 0, "导出 JSON 成功")

        # 导出 CSV
        r = client.get(f"{BASE}/datasets/{did}/export?format=csv", headers=H)
        check(r.status_code == 200 and r.json().get("format") == "csv" and "a,b" in r.json().get("content", ""), "导出 CSV 成功含表头")

        # 删除一条记录
        rec_id = client.get(f"{BASE}/datasets/{did}/records?limit=1", headers=H).json()[0]["id"]
        r = client.delete(f"{BASE}/datasets/{did}/records/{rec_id}", headers=H)
        check(r.status_code == 204, "删除记录 204")

        # 删除数据集
        r = client.delete(f"{BASE}/datasets/{did}", headers=H)
        check(r.status_code == 204, "删除数据集 204")

        # ════════ IDE ════════
        print("\n-- IDE --")
        r = client.get(f"{BASE}/ide/tree", headers=H)
        check(r.status_code == 200 and r.json().get("type") == "dir", "获取工作区树 200")

        # 写文件
        r = client.post(f"{BASE}/ide/file", json={"path": "scripts/hello.py", "content": "print('hello from ide')\nprint(1+1)\n"}, headers=H)
        check(r.status_code == 201 and r.json().get("name") == "hello.py", "写入文件 201")

        # 读文件
        r = client.get(f"{BASE}/ide/file?path=" + "scripts/hello.py", headers=H)
        check(r.status_code == 200 and "hello from ide" in r.json().get("content", ""), "读取文件内容正确")

        # 建目录
        r = client.post(f"{BASE}/ide/mkdir", json={"path": "data"}, headers=H)
        check(r.status_code == 201 and r.json().get("type") == "dir", "创建目录 201")

        # 运行（python）
        r = client.post(f"{BASE}/ide/run", json={"path": "scripts/hello.py"}, headers=H)
        check(r.status_code == 200, f"运行脚本 200 (got {r.status_code})")
        if r.status_code == 200:
            body = r.json()
            check("hello from ide" in body.get("stdout", "") and "2" in body.get("stdout", ""), "运行输出正确")
            check(body.get("exit_code") == 0, f"退出码 0 (got {body.get('exit_code')})")

        # 目录穿越防护
        r = client.get(f"{BASE}/ide/file?path=" + "../secret", headers=H)
        check(r.status_code in (400, 404), f"目录穿越被拦截 (got {r.status_code})")

        # 删除文件
        r = client.delete(f"{BASE}/ide/file?path=" + "scripts/hello.py", headers=H)
        check(r.status_code == 204, "删除文件 204")

    # 清理临时库
    try:
        os.remove(_TMP_DB)
    except OSError:
        pass

    print("\n=== 结果 ===")
    if _failures:
        print(f"失败 {len(_failures)} 项:")
        for f in _failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL PASSED")


if __name__ == "__main__":
    main()
