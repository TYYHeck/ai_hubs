# -*- coding: utf-8 -*-
"""
M6 冒烟测试：后台管理 API + CLI 客户端（端到端）

启动一个真实 uvicorn 服务（临时 SQLite 库），验证：
  1. 管理员登录 + 仪表盘统计
  2. 用户列表 / 更新 / 删除
  3. 非管理员访问被拒绝 (403)
  4. CLI 客户端（urllib）登录 / me / agents / skills / datasets
"""

from __future__ import annotations

import os
import sys
import time
import threading
import shutil
from pathlib import Path

# 必须在导入 app 之前设置临时数据库
_TMP_DB = Path(__file__).resolve().parent.parent / "m6_test.db"
if _TMP_DB.exists():
    _TMP_DB.unlink()
os.environ["DB_URL"] = f"sqlite+aiosqlite:///{_TMP_DB}"

# 将 backend 与项目根加入路径（cli 包位于项目根）
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))

import httpx
import uvicorn
from app.main import app

PORT = 8137
BASE = f"http://127.0.0.1:{PORT}"

results: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, detail: str = ""):
    results.append((name, cond, detail))
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f" -- {detail}" if detail and not cond else ""))


def _wait_health(timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(f"{BASE}/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def main():
    # ── 启动后端线程 ──
    config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="error")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    if not _wait_health():
        print("后端启动失败")
        server.should_exit = True
        return

    try:
        # ── 1. 管理员登录 ──
        r = httpx.post(f"{BASE}/api/v1/auth/login",
                       json={"username": "admin", "password": "admin123"}, timeout=10)
        check("管理员登录", r.status_code == 200, f"status={r.status_code}")
        admin_token = r.json().get("access_token", "")
        check("管理员令牌非空", bool(admin_token))
        ah = {"Authorization": f"Bearer {admin_token}"}

        # ── 2. 仪表盘统计 ──
        r = httpx.get(f"{BASE}/api/v1/admin/dashboard", headers=ah, timeout=10)
        check("仪表盘统计 200", r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            d = r.json()
            check("仪表盘含用户统计", "users" in d and "total" in d["users"])
            check("仪表盘含技能分布", "skills" in d and "by_source" in d["skills"])

        # ── 3. 用户列表 ──
        r = httpx.get(f"{BASE}/api/v1/admin/users", headers=ah, params={"page": 1, "page_size": 20}, timeout=10)
        check("用户列表 200", r.status_code == 200)
        if r.status_code == 200:
            ul = r.json()
            check("用户列表含 admin", any(u["username"] == "admin" for u in ul["items"]), f"total={ul.get('total')}")

        # ── 4. 注册一个普通用户（用于更新/删除测试）──
        # 测试环境无法发邮件，直接往 verification_codes 植入有效验证码
        import sqlite3
        _con = sqlite3.connect(str(_TMP_DB))
        try:
            _con.execute(
                "INSERT INTO verification_codes (email, code, purpose, expires_at, used, created_at) "
                "VALUES (?, '000000', 'register', '2099-12-31 23:59:59', 0, '2024-01-01 00:00:00')",
                ("m6test@example.com",),
            )
            _con.commit()
        finally:
            _con.close()

        r = httpx.post(f"{BASE}/api/v1/auth/register", json={
            "username": "m6test", "password": "Test1234!", "confirm_password": "Test1234!",
            "email": "m6test@example.com", "code": "000000",
        }, timeout=10)
        check("注册测试用户 200", r.status_code == 200, f"status={r.status_code} detail={r.text[:120]}")
        new_uid = r.json().get("user", {}).get("id") if r.status_code == 200 else None

        if new_uid:
            # ── 6. 非管理员拒绝访问（此时用户仍活跃）──
            r2 = httpx.post(f"{BASE}/api/v1/auth/login",
                            json={"username": "m6test", "password": "Test1234!"}, timeout=10)
            check("普通用户登录 200", r2.status_code == 200, f"status={r2.status_code}")
            if r2.status_code == 200:
                ut = r2.json().get("access_token", "")
                uh = {"Authorization": f"Bearer {ut}"}
                r3 = httpx.get(f"{BASE}/api/v1/admin/dashboard", headers=uh, timeout=10)
                check("非管理员访问 admin 被拒 403", r3.status_code == 403, f"status={r3.status_code}")

            # ── 4. 更新：禁用 ──
            r = httpx.put(f"{BASE}/api/v1/admin/users/{new_uid}", headers=ah,
                          json={"is_active": False, "role": "user"}, timeout=10)
            check("更新用户 200", r.status_code == 200)
            if r.status_code == 200:
                check("更新生效(is_active=False)", r.json().get("is_active") is False)

            # 删除
            r = httpx.delete(f"{BASE}/api/v1/admin/users/{new_uid}", headers=ah, timeout=10)
            check("删除用户 200", r.status_code == 200)
            # 删除后查不到
            r = httpx.get(f"{BASE}/api/v1/admin/users/{new_uid}", headers=ah, timeout=10)
            check("删除后用户不存在 404", r.status_code == 404)

        # ── 5. 管理员不能删除自己 ──
        r = httpx.delete(f"{BASE}/api/v1/admin/users/1", headers=ah, timeout=10)
        check("禁止删除自己 400", r.status_code == 400, f"status={r.status_code}")

        # ── 7. CLI 客户端端到端（urllib）──
        from cli.api import APIClient
        cli = APIClient(base_url=BASE)
        try:
            u = cli.login("admin", "admin123")
            check("CLI 登录", u.get("username") == "admin", str(u))
        except Exception as e:
            check("CLI 登录", False, f"{type(e).__name__}: {e}")
            cli = None

        if cli:
            try:
                me = cli.me()
                check("CLI me", me.get("username") == "admin")
            except Exception as e:
                check("CLI me", False, f"{type(e).__name__}: {e}")

            for label, fn in [
                ("CLI agents", lambda: cli.agents()),
                ("CLI skills", lambda: cli.skills()),
                ("CLI datasets", lambda: cli.datasets()),
            ]:
                try:
                    data = fn()
                    check(label, isinstance(data, list), f"type={type(data).__name__}")
                except Exception as e:
                    check(label, False, f"{type(e).__name__}: {e}")

    finally:
        server.should_exit = True
        time.sleep(1)

    passed = sum(1 for _, c, _ in results if c)
    total = len(results)
    print(f"\n结果: {passed}/{total} 通过")
    if passed != total:
        sys.exit(1)
    print("ALL PASSED")


if __name__ == "__main__":
    main()
