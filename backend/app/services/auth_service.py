# -*- coding: utf-8 -*-
"""
认证服务 — 注册、登录、验证码

需求文档要求：
- 用户名/密码长度+混合字符验证
- 邮箱验证码注册（发送邮箱: 3526145827@qq.com）
- 密码确认
- JWT 令牌
"""

from __future__ import annotations

import random
import smtplib
import string
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.user import User, VerificationCode
from ..security import hash_password, verify_password, create_access_token


# ============================================================
# 验证
# ============================================================

def validate_username(username: str) -> str | None:
    """验证用户名，返回错误信息或 None"""
    if len(username) < 3:
        return "用户名至少 3 个字符"
    if len(username) > 32:
        return "用户名最多 32 个字符"
    if not username.replace("_", "").replace("-", "").isalnum():
        return "用户名只能包含字母、数字、下划线和短横线"
    return None


def validate_password(password: str) -> str | None:
    """验证密码强度，返回错误信息或 None"""
    if len(password) < 8:
        return "密码至少 8 个字符"
    if len(password) > 64:
        return "密码最多 64 个字符"
    has_alpha = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    if not (has_alpha and has_digit):
        return "密码必须包含字母和数字"
    return None


def validate_email(email: str) -> str | None:
    """简单验证邮箱格式"""
    if not email or "@" not in email or "." not in email:
        return "邮箱格式不正确"
    return None


# ============================================================
# 验证码
# ============================================================

def generate_code() -> str:
    """生成 6 位数字验证码"""
    return "".join(random.choices(string.digits, k=6))


async def send_verification_code(email: str, session: AsyncSession) -> str:
    """
    生成并发送验证码到邮箱。

    返回生成的验证码（测试时可查看日志）。
    需求指定邮箱: 3526145827@qq.com, 授权码: jnaoofgohquidbed
    """
    code = generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.email.code_expire_minutes)

    # 存入数据库（使旧验证码失效）
    await session.execute(
        update(VerificationCode)
        .where(VerificationCode.email == email, VerificationCode.used == False)  # noqa: E712
        .values(used=True)
    )
    session.add(VerificationCode(
        email=email,
        code=code,
        purpose="register",
        expires_at=expires_at,
    ))
    await session.flush()

    # 发送邮件
    try:
        _send_email(email, code)
    except Exception as e:
        # 邮件发送失败不阻断流程（开发环境下验证码在日志中可见）
        import logging
        logging.getLogger("ai_hubs.auth").warning(f"邮件发送失败: {e}, 验证码: {code}")
        # 重新抛出，让调用方决定
        raise

    return code


def _send_email(to_email: str, code: str) -> None:
    """通过 QQ 邮箱 SMTP 发送验证码"""
    cfg = settings.email
    msg = MIMEMultipart("alternative")
    msg["From"] = cfg.sender
    msg["To"] = to_email
    msg["Subject"] = "AI Hubs 注册验证码"

    html = f"""
    <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #3b82f6;">AI Hubs 注册验证码</h2>
        <p>您的验证码是：</p>
        <div style="font-size: 32px; font-weight: bold; color: #3b82f6;
                    letter-spacing: 8px; padding: 16px; background: #f0f0f0;
                    border-radius: 8px; text-align: center;">{code}</div>
        <p style="color: #999; font-size: 12px; margin-top: 16px;">
            验证码 {cfg.code_expire_minutes} 分钟内有效，请尽快使用。
        </p>
    </div>
    """
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port) as server:
        server.login(cfg.sender, cfg.password)
        server.sendmail(cfg.sender, [to_email], msg.as_string())


async def verify_code(email: str, code: str, session: AsyncSession) -> bool:
    """验证邮箱验证码是否正确且未过期"""
    result = await session.execute(
        select(VerificationCode)
        .where(
            VerificationCode.email == email,
            VerificationCode.code == code,
            VerificationCode.used == False,  # noqa: E712
            VerificationCode.expires_at > datetime.now(timezone.utc),
        )
        .order_by(VerificationCode.created_at.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if record is None:
        return False
    record.used = True
    return True


# ============================================================
# 用户注册 / 登录
# ============================================================

async def register_user(
    username: str,
    password: str,
    email: str,
    code: str,
    session: AsyncSession,
) -> User:
    """注册新用户"""
    # 验证码校验
    if not await verify_code(email, code, session):
        raise ValueError("验证码无效或已过期")

    # 用户名唯一性
    existing = await session.execute(
        select(User).where(User.username == username)
    )
    if existing.scalar_one_or_none():
        raise ValueError("用户名已存在")

    # 邮箱唯一性
    existing = await session.execute(
        select(User).where(User.email == email)
    )
    if existing.scalar_one_or_none():
        raise ValueError("邮箱已被注册")

    user = User(
        username=username,
        password_hash=hash_password(password),
        email=email,
        role="user",
        preferences={"token_quota": User.DEFAULT_TOKEN_QUOTA},
    )
    session.add(user)
    await session.flush()
    return user


async def authenticate_user(
    username: str,
    password: str,
    session: AsyncSession,
) -> tuple[User, str]:
    """
    验证用户登录，返回 (user, token)。

    Raises ValueError if credentials invalid.
    """
    result = await session.execute(
        select(User).where(User.username == username)
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(password, user.password_hash):
        raise ValueError("用户名或密码错误")

    if not user.is_active:
        raise ValueError("账户已被禁用")

    # 更新最后登录时间
    user.last_login_at = datetime.now(timezone.utc)

    token = create_access_token({"sub": user.username, "role": user.role})
    return user, token


async def ensure_default_admin(session: AsyncSession) -> None:
    """确保默认管理员存在（首次启动时创建）"""
    result = await session.execute(
        select(User).where(User.username == settings.auth.default_admin_username)
    )
    if result.scalar_one_or_none() is None:
        admin = User(
            username=settings.auth.default_admin_username,
            password_hash=hash_password(settings.auth.default_admin_password),
            email="admin@ai-hubs.local",
            role="admin",
        )
        session.add(admin)
        await session.flush()
        import logging
        logging.getLogger("ai_hubs.auth").info(
            f"已创建默认管理员: {admin.username} (请尽快修改密码)"
        )
