import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { authApi } from '../api/client';

type Step = 'login' | 'register';

export default function AuthPage() {
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);

  // ── 步骤切换
  const [step, setStep] = useState<Step>('login');

  // ── 登录表单
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // ── 注册表单
  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regCode, setRegCode] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [sendCodeLoading, setSendCodeLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);

  // ── 错误提示
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }, []);

  // ── 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass) {
      showError('请输入用户名和密码');
      return;
    }
    setLoginLoading(true);
    setError(null);
    try {
      const res = await authApi.login(loginUser.trim(), loginPass);
      if (res.ok && res.access_token) {
        localStorage.setItem('token', res.access_token);
        if (res.user) {
          setCurrentUser(res.user as Record<string, unknown>);
        }
        setLoggedIn(true, res.access_token);
        showSuccess('登录成功！');
      } else {
        showError(res.error || '登录失败');
      }
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message?.includes('401')) {
        showError('用户名或密码错误');
      } else {
        showError('登录失败，请检查网络连接');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  // ── 发送验证码
  const handleSendCode = async () => {
    if (!regEmail.trim()) {
      showError('请先输入邮箱地址');
      return;
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(regEmail.trim())) {
      showError('邮箱格式不正确');
      return;
    }
    setSendCodeLoading(true);
    setError(null);
    try {
      const res = await authApi.sendCode(regEmail.trim());
      if (res.ok) {
        showSuccess('验证码已发送，请查收邮件');
        setCodeSent(true);
        setCodeCountdown(60);
        const timer = setInterval(() => {
          setCodeCountdown((c) => {
            if (c <= 1) { clearInterval(timer); return 0; }
            return c - 1;
          });
        }, 1000);
      } else {
        showError(res.error || '发送失败');
      }
    } catch {
      showError('发送验证码失败');
    } finally {
      setSendCodeLoading(false);
    }
  };

  // ── 注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 客户端校验
    if (regUser.trim().length < 2) { showError('用户名至少 2 个字符'); return; }
    if (regUser.length > 32) { showError('用户名最长 32 个字符'); return; }
    if (!/^[\w\u4e00-\u9fff]+$/.test(regUser.trim())) { showError('用户名只能包含字母、数字、下划线、中文'); return; }
    if (regPass.length < 8) { showError('密码至少 8 个字符'); return; }
    if (regPass.length > 64) { showError('密码最长 64 个字符'); return; }
    if (!/[a-z]/.test(regPass)) { showError('密码必须包含小写字母'); return; }
    if (!/[A-Z]/.test(regPass)) { showError('密码必须包含大写字母'); return; }
    if (!/\d/.test(regPass)) { showError('密码必须包含数字'); return; }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(regPass)) { showError('密码必须包含至少一个特殊字符'); return; }
    if (regPass !== regConfirm) { showError('两次输入的密码不一致'); return; }
    if (!regEmail.trim()) { showError('请输入邮箱'); return; }
    if (!/^\d{6}$/.test(regCode.trim())) { showError('验证码为 6 位数字'); return; }

    setRegLoading(true);
    try {
      const res = await authApi.register(
        regUser.trim(), regPass, regConfirm, regEmail.trim(), regCode.trim(),
      );
      if (res.ok) {
        showSuccess('注册成功！请登录');
        // 切回登录页并预填用户名
        setLoginUser(regUser.trim());
        setStep('login');
      } else {
        showError(res.error || '注册失败');
      }
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message?.includes('409')) {
        showError('用户名或邮箱已存在');
      } else {
        showError('注册失败，请稍后重试');
      }
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* 背景 */}
      <div className="auth-bg" />

      {/* 主体 */}
      <div className="auth-container">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">AH</div>
          <h1>AI Hubs</h1>
          <p>AI集群 · 新一代智能 Agent 平台</p>
        </div>

        {/* 提示消息 */}
        <div className={`auth-toast ${error ? 'toast-error' : ''} ${success ? 'toast-success' : ''}`}>
          {error && <div className="toast-msg error">{error}</div>}
          {success && <div className="toast-msg success">{success}</div>}
        </div>

        {/* Tab 切换 */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${step === 'login' ? 'active' : ''}`}
            onClick={() => { setStep('login'); setError(null); setSuccess(null); }}
          >
            登录
          </button>
          <button
            className={`auth-tab ${step === 'register' ? 'active' : ''}`}
            onClick={() => { setStep('register'); setError(null); setSuccess(null); }}
          >
            注册
          </button>
        </div>

        {/* 登录表单 */}
        {step === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <div className="auth-field">
              <label>用户名</label>
              <input
                type="text"
                placeholder="请输入用户名"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                maxLength={32}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="auth-field">
              <label>密码</label>
              <input
                type="password"
                placeholder="请输入密码"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                maxLength={64}
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="auth-btn primary"
              disabled={loginLoading}
            >
              {loginLoading ? '登录中...' : '登录'}
            </button>
          </form>
        )}

        {/* 注册表单 */}
        {step === 'register' && (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-field">
              <label>用户名</label>
              <input
                type="text"
                placeholder="2-32 字符，支持字母数字下划线中文"
                value={regUser}
                onChange={(e) => setRegUser(e.target.value)}
                maxLength={32}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="auth-field">
              <label>邮箱</label>
              <div className="auth-email-row">
                <input
                  type="email"
                  placeholder="请输入邮箱地址"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  maxLength={128}
                  autoComplete="email"
                />
                <button
                  type="button"
                  className="auth-btn small"
                  onClick={handleSendCode}
                  disabled={sendCodeLoading || codeCountdown > 0}
                >
                  {sendCodeLoading
                    ? '发送中...'
                    : codeCountdown > 0
                      ? `${codeCountdown}s`
                      : codeSent
                        ? '重新发送'
                        : '获取验证码'}
                </button>
              </div>
            </div>
            <div className="auth-field">
              <label>验证码</label>
              <input
                type="text"
                placeholder="请输入 6 位数字验证码"
                value={regCode}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setRegCode(v); }}
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>
            <div className="auth-field">
              <label>密码</label>
              <input
                type="password"
                placeholder="8-64 字符，须含大小写字母+数字+特殊字符"
                value={regPass}
                onChange={(e) => setRegPass(e.target.value)}
                maxLength={64}
                autoComplete="new-password"
              />
            </div>
            <div className="auth-field">
              <label>确认密码</label>
              <input
                type="password"
                placeholder="再次输入密码"
                value={regConfirm}
                onChange={(e) => setRegConfirm(e.target.value)}
                maxLength={64}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              className="auth-btn primary"
              disabled={regLoading}
            >
              {regLoading ? '注册中...' : '注册'}
            </button>
          </form>
        )}
      </div>

      {/* 样式 */}
      <style>{`
        .auth-page {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }
        .auth-bg {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #0d1117 0%, #161b22 40%, #1a1a2e 70%, #16213e 100%);
          z-index: 0;
        }
        .auth-bg::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle at 25% 25%, rgba(88,166,255,0.06) 0%, transparent 50%),
                      radial-gradient(circle at 75% 75%, rgba(163,113,247,0.06) 0%, transparent 50%);
          animation: authFloat 20s ease-in-out infinite;
        }
        @keyframes authFloat {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          33% { transform: translate(30px, -30px) rotate(1deg); }
          66% { transform: translate(-20px, 20px) rotate(-1deg); }
        }

        .auth-container {
          position: relative;
          z-index: 1;
          width: 400px;
          max-width: 92vw;
          background: rgba(22, 27, 34, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(48, 54, 61, 0.6);
          border-radius: 16px;
          padding: 40px 36px 36px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }

        .auth-logo { text-align: center; margin-bottom: 28px; }
        .auth-logo-icon {
          display: inline-flex; width: 60px; height: 60px;
          align-items: center; justify-content: center;
          background: linear-gradient(135deg, #58a6ff, #a371f7);
          border-radius: 14px; font-size: 22px; font-weight: 800;
          color: #fff; margin-bottom: 12px;
          box-shadow: 0 4px 16px rgba(88,166,255,0.3);
        }
        .auth-logo h1 { font-size: 22px; color: #f0f6fc; margin: 0 0 4px; font-weight: 700; }
        .auth-logo p { font-size: 12px; color: #8b949e; margin: 0; }

        .auth-toast { min-height: 36px; margin-bottom: 8px; }
        .toast-msg {
          padding: 10px 14px; border-radius: 8px; font-size: 13px; line-height: 1.4;
          animation: slideDown 0.3s ease;
        }
        .toast-msg.error { background: rgba(248,81,73,0.12); color: #f85149; border: 1px solid rgba(248,81,73,0.25); }
        .toast-msg.success { background: rgba(63,185,80,0.12); color: #3fb950; border: 1px solid rgba(63,185,80,0.25); }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

        .auth-tabs { display: flex; gap: 4px; margin-bottom: 24px; background: #21262d; border-radius: 10px; padding: 3px; }
        .auth-tab {
          flex: 1; padding: 9px; border: none; border-radius: 8px; cursor: pointer;
          background: transparent; color: #8b949e; font-size: 14px; font-weight: 500;
          transition: all 0.2s;
        }
        .auth-tab.active { background: #30363d; color: #f0f6fc; }
        .auth-tab:hover:not(.active) { color: #c9d1d9; }

        .auth-form { display: flex; flex-direction: column; gap: 16px; }
        .auth-field { display: flex; flex-direction: column; gap: 6px; }
        .auth-field label {
          font-size: 12px; color: #8b949e; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .auth-field input {
          padding: 10px 14px; border: 1px solid #30363d; border-radius: 10px;
          background: #0d1117; color: #f0f6fc; font-size: 14px; outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          width: 100%;
        }
        .auth-field input:focus { border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
        .auth-field input::placeholder { color: #484f58; }
        .auth-email-row { display: flex; gap: 8px; }
        .auth-email-row input { flex: 1; }

        .auth-btn {
          padding: 10px 24px; border: none; border-radius: 10px; cursor: pointer;
          font-size: 14px; font-weight: 600; transition: all 0.2s;
        }
        .auth-btn.primary {
          background: linear-gradient(135deg, #58a6ff, #a371f7); color: #fff; padding: 12px;
          box-shadow: 0 4px 12px rgba(88,166,255,0.25);
        }
        .auth-btn.primary:hover { box-shadow: 0 6px 20px rgba(88,166,255,0.4); transform: translateY(-1px); }
        .auth-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
        .auth-btn.small {
          padding: 10px 14px; background: #21262d; color: #58a6ff; border: 1px solid #30363d;
          font-size: 12px; white-space: nowrap; flex-shrink: 0;
        }
        .auth-btn.small:hover:not(:disabled) { background: #30363d; }
        .auth-btn.small:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
