# -*- coding: utf-8 -*-
"""
数据库引擎 — MySQL/SQLite 自动切换

策略：
  1. 环境变量 DB_URL 存在 → 直接使用该 URL
  2. config.database.force_sqlite=True → 强制 SQLite（桌面端/本地开发）
  3. MySQL 配置有密码 → 尝试连接 MySQL，失败则回退 SQLite
  4. 其余情况 → SQLite（零配置）

SQLite 路径: {PROJECT_ROOT}/data/ai_hubs.db（自动创建目录）
MySQL 驱动: aiomysql    SQLite 驱动: aiosqlite
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import settings, PROJECT_ROOT

logger = logging.getLogger("ai_hubs.database")

# 全局状态
_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None
_db_type: str = "none"  # "mysql" | "sqlite"


# ============================================================
# URL 构建
# ============================================================

def _build_mysql_url() -> str:
    """构建 MySQL 异步连接 URL"""
    cfg = settings.database.mysql
    from urllib.parse import quote_plus
    return (
        f"mysql+aiomysql://{quote_plus(cfg.user)}:{quote_plus(cfg.password)}"
        f"@{cfg.host}:{cfg.port}/{cfg.database}?charset=utf8mb4"
    )


def _build_sqlite_url() -> str:
    """构建 SQLite 异步连接 URL"""
    sqlite_path = Path(settings.database.sqlite_path)
    if not sqlite_path.is_absolute():
        # 相对路径基于项目根目录
        sqlite_path = PROJECT_ROOT / sqlite_path
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{sqlite_path}"


async def _test_mysql_connection(url: str) -> bool:
    """快速测试 MySQL 是否可连接（1.5s 超时）"""
    try:
        test_engine = create_async_engine(url, pool_size=1, connect_args={"connect_timeout": 2})
        from sqlalchemy import text
        async with test_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await test_engine.dispose()
        return True
    except Exception as e:
        logger.warning(f"MySQL 连接失败，将回退 SQLite: {type(e).__name__}: {e}")
        return False


# ============================================================
# 引擎初始化
# ============================================================

async def init_database() -> AsyncEngine:
    """
    初始化数据库引擎（在 FastAPI startup 事件中调用）

    自动选择 MySQL 或 SQLite，并创建表结构。
    """
    global _engine, _session_factory, _db_type

    # 1. 环境变量 DB_URL 优先
    db_url = os.getenv("DB_URL", "")

    # 2. 强制 SQLite
    if not db_url and settings.database.force_sqlite:
        db_url = _build_sqlite_url()
        _db_type = "sqlite"
        logger.info("强制使用 SQLite 模式")

    # 3. 尝试 MySQL
    if not db_url:
        mysql_cfg = settings.database.mysql
        if mysql_cfg.password:
            mysql_url = _build_mysql_url()
            if await _test_mysql_connection(mysql_url):
                db_url = mysql_url
                _db_type = "mysql"
                logger.info(f"已连接 MySQL: {mysql_cfg.host}:{mysql_cfg.port}/{mysql_cfg.database}")
            else:
                logger.warning("MySQL 不可用，回退到 SQLite")
        else:
            logger.info("未配置 MySQL 密码，使用 SQLite 模式（零配置）")

    # 4. 回退 SQLite
    if not db_url:
        db_url = _build_sqlite_url()
        _db_type = "sqlite"

    if _db_type == "sqlite":
        sqlite_path = Path(settings.database.sqlite_path)
        if not sqlite_path.is_absolute():
            sqlite_path = PROJECT_ROOT / sqlite_path
        logger.info(f"使用 SQLite: {sqlite_path}")

    # 创建引擎
    engine_kwargs: dict = {
        "echo": False,
        "pool_pre_ping": _db_type == "mysql",
    }
    if _db_type == "mysql":
        engine_kwargs["pool_size"] = 10
        engine_kwargs["max_overflow"] = 20
        engine_kwargs["pool_recycle"] = 3600

    _engine = create_async_engine(db_url, **engine_kwargs)
    _session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # 自动创建表（SQLite 首次运行 / MySQL 无表时）
    await _create_tables()

    return _engine


async def _create_tables():
    """创建所有表（如果不存在），并对旧表做增量迁移"""
    from .models.base import Base
    from sqlalchemy import inspect, text
    # 导入所有模型以确保它们被注册到 Base.metadata
    from .models import user, agent, task, skill, dataset, memory, conversation, system, knowledge  # noqa: F401

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # ── 增量迁移：为已在 M0-M3 创建的旧表补充 M4 新增列 ──
        def _migrate(sync_conn):
            insp = inspect(sync_conn)
            try:
                cols = {c["name"] for c in insp.get_columns("memory_commits")}
            except Exception:
                cols = set()
            if "commit_type" not in cols:
                logger.info("迁移: memory_commits 补充 commit_type 列")
                sync_conn.execute(
                    text("ALTER TABLE memory_commits ADD COLUMN commit_type VARCHAR(16) NOT NULL DEFAULT 'turn'")
                )

        await conn.run_sync(_migrate)

    logger.info(f"数据库表已就绪 ({_db_type})")


async def close_database():
    """关闭数据库引擎（在 FastAPI shutdown 事件中调用）"""
    global _engine, _session_factory, _db_type
    if _engine:
        await _engine.dispose()
        logger.info(f"数据库引擎已关闭 (原类型: {_db_type})")
    _engine = None
    _session_factory = None
    _db_type = "none"


# ============================================================
# 会话管理（FastAPI 依赖注入）
# ============================================================

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """获取数据库会话（FastAPI 依赖注入用）"""
    if _session_factory is None:
        raise RuntimeError("数据库引擎未初始化，请先调用 init_database()")
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


class SessionContext:
    """异步上下文管理器，便于在非路由代码中使用（async with ... as session）"""

    def __init__(self):
        if _session_factory is None:
            raise RuntimeError("数据库引擎未初始化")
        self._ctx = _session_factory()

    async def __aenter__(self) -> AsyncSession:
        self._session = await self._ctx.__aenter__()
        return self._session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            await self._session.rollback()
        else:
            await self._session.commit()
        await self._ctx.__aexit__(exc_type, exc_val, exc_tb)


def create_session() -> SessionContext:
    """创建一个数据库会话（用于 async with 语句）"""
    return SessionContext()


def get_db_type() -> str:
    """获取当前数据库类型"""
    return _db_type


def is_db_available() -> bool:
    """数据库是否已初始化"""
    return _engine is not None and _session_factory is not None
