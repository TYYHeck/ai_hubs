# -*- coding: utf-8 -*-
"""AI Hubs CLI — 命令行客户端（连接 v4 后端 /api/v1）"""

from .api import APIClient
from .repl import main

__all__ = ["APIClient", "main"]
