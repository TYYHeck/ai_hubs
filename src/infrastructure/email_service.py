# -*- coding: utf-8 -*-
"""
邮件发送服务 —— 用于邮箱验证码、通知等
"""

import smtplib
import random
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Optional
import threading

logger = logging.getLogger("ai_hubs.email")

# 邮件配置
SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 587
SMTP_USER = "3526145827@qq.com"
SMTP_PASS = "jnaoofgohquidbed"
SENDER_NAME = "AI Hubs"

# 验证码存储（内存 + 过期时间）
_verification_codes: dict[str, dict] = {}
_lock = threading.Lock()


def generate_code(length: int = 6) -> str:
    """生成随机数字验证码"""
    return "".join(str(random.randint(0, 9)) for _ in range(length))


def send_verification_email(to_email: str, code: str) -> bool:
    """发送验证码邮件

    Args:
        to_email: 收件人邮箱
        code: 6位验证码

    Returns:
        是否发送成功
    """
    try:
        msg = MIMEMultipart()
        msg["From"] = f"{SENDER_NAME} <{SMTP_USER}>"
        msg["To"] = to_email
        msg["Subject"] = "AI Hubs — 邮箱验证码"

        html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8f9fa;">
<div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
  <div style="text-align:center;margin-bottom:24px;">
    <h2 style="color:#1a1a2e;margin:0;font-size:22px;">AI Hubs</h2>
    <p style="color:#6b7280;margin:4px 0 0;font-size:13px;">新一代智能 Agent 平台</p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
  <p style="color:#374151;font-size:14px;line-height:1.7;">你好，</p>
  <p style="color:#374151;font-size:14px;line-height:1.7;">你正在注册 AI Hubs 账号。请使用以下验证码完成验证：</p>
  <div style="text-align:center;margin:28px 0;">
    <span style="display:inline-block;background:linear-gradient(135deg,#58a6ff,#a371f7);color:#fff;font-size:28px;font-weight:700;letter-spacing:6px;padding:12px 32px;border-radius:10px;">{code}</span>
  </div>
  <p style="color:#9ca3af;font-size:12px;line-height:1.6;">验证码有效期为 <strong>10 分钟</strong>，请勿将验证码透露给他人。</p>
  <p style="color:#9ca3af;font-size:12px;">如果这不是你的操作，请忽略此邮件。</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
  <p style="color:#9ca3af;font-size:11px;text-align:center;">AI Hubs · 智能 Agent 平台</p>
</div>
</body>
</html>"""

        msg.attach(MIMEText(html_body, "html", "utf-8"))

        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, to_email, msg.as_string())
        server.quit()

        logger.info(f"验证码已发送至 {to_email}")
        return True

    except smtplib.SMTPAuthenticationError:
        logger.error("SMTP 认证失败，请检查邮箱账号和授权码")
        return False
    except Exception as e:
        logger.error(f"发送验证码失败: {e}")
        return False


def store_verification_code(email: str, code: str, ttl_minutes: int = 10):
    """存储验证码（带过期时间）"""
    with _lock:
        _verification_codes[email] = {
            "code": code,
            "expires_at": datetime.now() + timedelta(minutes=ttl_minutes),
            "attempts": 0,
        }


def verify_code(email: str, code: str) -> bool:
    """验证邮箱验证码

    Args:
        email: 邮箱地址
        code: 用户输入的验证码

    Returns:
        验证是否通过
    """
    with _lock:
        stored = _verification_codes.get(email)
        if stored is None:
            return False

        # 检查过期
        if datetime.now() > stored["expires_at"]:
            del _verification_codes[email]
            return False

        # 检查尝试次数（最多5次）
        if stored["attempts"] >= 5:
            del _verification_codes[email]
            return False

        stored["attempts"] += 1

        if stored["code"] == code:
            del _verification_codes[email]
            return True

        return False


def can_send_code(email: str, cooldown_seconds: int = 60) -> bool:
    """检查是否可再次发送（冷却时间）"""
    with _lock:
        stored = _verification_codes.get(email)
        if stored is None:
            return True
        # 检查是否在冷却期内（上次发送后60秒内不允许重发）
        elapsed = (datetime.now() - (stored["expires_at"] - timedelta(minutes=10))).total_seconds()
        return elapsed > cooldown_seconds
