# -*- coding: utf-8 -*-
"""
配置管理 — YAML 文件 + 环境变量覆盖

优先级: 环境变量 > config.yaml > 默认值
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

# ── 路径常量 ──
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # ai_hubs/
BACKEND_DIR = Path(__file__).resolve().parent.parent            # ai_hubs/backend/
DATA_DIR = PROJECT_ROOT / "data"


# ============================================================
# 配置模型
# ============================================================

class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8080


class MySQLConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 3306
    user: str = "ai_hubs"
    password: str = ""
    database: str = "ai_hubs"


class DatabaseConfig(BaseModel):
    mysql: MySQLConfig = Field(default_factory=MySQLConfig)
    sqlite_path: str = "data/ai_hubs.db"
    # 设为 true 强制使用 SQLite（桌面端/本地开发）
    force_sqlite: bool = False


class AuthConfig(BaseModel):
    jwt_secret: str = "ai-hubs-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    default_admin_username: str = "admin"
    default_admin_password: str = "admin123"


class EmailConfig(BaseModel):
    smtp_host: str = "smtp.qq.com"
    smtp_port: int = 465
    sender: str = "3526145827@qq.com"
    password: str = "jnaoofgohquidbed"
    code_expire_minutes: int = 5


class LLMConfig(BaseModel):
    default_provider: str = "deepseek"
    default_model: str = "deepseek-chat"


class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    email: EmailConfig = Field(default_factory=EmailConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)


# ============================================================
# 加载逻辑
# ============================================================

def _load_yaml() -> dict[str, Any]:
    """加载 config.yaml（从 backend/ 目录，不与旧版根 config.yaml 冲突）"""
    yaml_path = BACKEND_DIR / "config.yaml"
    if yaml_path.exists():
        with open(yaml_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def _apply_env_overrides(data: dict[str, Any]) -> dict[str, Any]:
    """用环境变量覆盖配置（AIHUBS_ 前缀，双下划线分隔层级）"""
    prefix = "AIHUBS_"
    for key, value in os.environ.items():
        if not key.startswith(prefix):
            continue
        path = key[len(prefix):].lower().split("__")
        node = data
        for part in path[:-1]:
            if part not in node or not isinstance(node[part], dict):
                node[part] = {}
            node = node[part]
        node[path[-1]] = _parse_env_value(value)
    return data


def _parse_env_value(value: str) -> Any:
    """尝试将环境变量值转换为合适的类型"""
    if value.lower() in ("true", "yes", "1"):
        return True
    if value.lower() in ("false", "no", "0"):
        return False
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def load_config() -> AppConfig:
    """加载完整配置：YAML → 环境变量覆盖 → AppConfig"""
    data = _load_yaml()
    data = _apply_env_overrides(data)
    return AppConfig(**data)


# 全局配置单例
settings = load_config()
