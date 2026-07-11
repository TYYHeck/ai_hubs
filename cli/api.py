# -*- coding: utf-8 -*-
"""AI Hubs CLI — 后端 HTTP 客户端（零外部依赖，使用标准库 urllib）"""

from __future__ import annotations

import json
import os
import urllib.request
import urllib.error

_DEFAULT_BASE = os.environ.get("AIHUBS_BASE_URL", "http://localhost:8080").rstrip("/")
_SESSION_FILE = os.path.join(os.path.expanduser("~"), ".aihubs", "cli_session.json")


class APIError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(f"[{status}] {message}")


class APIClient:
    """封装对 AI Hubs 后端 /api/v1 的调用。"""

    def __init__(self, base_url: str = _DEFAULT_BASE):
        self.base = base_url.rstrip("/")
        self.api_base = f"{self.base}/api/v1"
        self.token: str | None = None
        self.username: str | None = None
        self._load_session()

    # ── 会话持久化 ──
    def _load_session(self):
        try:
            with open(_SESSION_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.token = data.get("token")
            self.username = data.get("username")
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass

    def _save_session(self):
        os.makedirs(os.path.dirname(_SESSION_FILE), exist_ok=True)
        with open(_SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump({"token": self.token, "username": self.username}, f)

    def logout(self):
        self.token = None
        self.username = None
        try:
            os.remove(_SESSION_FILE)
        except OSError:
            pass

    # ── 底层请求 ──
    def _headers(self, content_type: bool = True) -> dict:
        h = {}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if content_type:
            h["Content-Type"] = "application/json"
        return h

    def request(self, method: str, path: str, json_body=None, as_text=True):
        url = f"{self.api_base}{path}"
        data = json.dumps(json_body).encode("utf-8") if json_body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except (json.JSONDecodeError, AttributeError):
                pass
            raise APIError(e.code, str(detail))
        except urllib.error.URLError as e:
            raise APIError(0, f"无法连接到后端 {url}：{e.reason}")
        if as_text:
            try:
                return json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return raw
        return raw

    # ── 业务方法 ──
    def login(self, username: str, password: str) -> dict:
        result = self.request("POST", "/auth/login", {"username": username, "password": password})
        self.token = result.get("access_token")
        self.username = result.get("user", {}).get("username", username)
        self._save_session()
        return result.get("user", {})

    def me(self) -> dict:
        return self.request("GET", "/auth/me").get("user", {})

    def agents(self) -> list:
        return self.request("GET", "/agents") or []

    def skills(self) -> list:
        return self.request("GET", "/skills") or []

    def datasets(self) -> list:
        return self.request("GET", "/datasets") or []

    def chat(self, message: str, conversation_id: str | None = None):
        """流式对话，逐块 yield 文本片段。"""
        body = {"message": message, "conversation_id": conversation_id}
        url = f"{self.api_base}/chat/stream"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"), method="POST", headers=self._headers()
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                buffer = ""
                while True:
                    chunk = resp.read(512).decode("utf-8", "replace")
                    if not chunk:
                        break
                    buffer += chunk
                    while "\n\n" in buffer:
                        event, buffer = buffer.split("\n\n", 1)
                        for line in event.splitlines():
                            line = line.strip()
                            if not line.startswith("data:"):
                                continue
                            payload = line[len("data:"):].strip()
                            try:
                                obj = json.loads(payload)
                            except json.JSONDecodeError:
                                continue
                            ev = obj.get("event")
                            if ev == "delta":
                                yield obj.get("content", "")
                            elif ev == "error":
                                yield f"\n[错误] {obj.get('message', '未知错误')}"
                            elif ev == "done":
                                return
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except (json.JSONDecodeError, AttributeError):
                pass
            raise APIError(e.code, str(detail))
        except urllib.error.URLError as e:
            raise APIError(0, f"无法连接到后端：{e.reason}")
