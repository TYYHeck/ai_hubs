// AI Hubs — 登录/注册页
// 需求：固定框宽高、错误顶部弹出、邮箱验证码、密码确认

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { authApi } from '../api/client'
import { AlertCircle, Mail, Loader2 } from 'lucide-react'

type Tab = 'login' | 'register'

export default function AuthPage() {
  const navigate = useNavigate()
  const { login, loading, error, clearError } = useAuthStore()

  const [tab, setTab] = useState<Tab>('login')
  const [topError, setTopError] = useState('')

  // 登录表单
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })

  // 注册表单
  const [regForm, setRegForm] = useState({
    username: '', password: '', confirmPassword: '', email: '', code: '',
  })

  // 验证码倒计时
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const showTopError = useCallback((msg: string) => {
    setTopError(msg)
    setTimeout(() => setTopError(''), 4000)
  }, [])

  // ── 登录 ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setTopError('')
    if (!loginForm.username || !loginForm.password) {
      showTopError('请填写用户名和密码')
      return
    }
    const ok = await login(loginForm.username, loginForm.password)
    if (ok) navigate('/')
    else showTopError(error || '登录失败')
  }

  // ── 发送验证码 ──
  const handleSendCode = async () => {
    if (!regForm.email || !regForm.email.includes('@')) {
      showTopError('请输入有效的邮箱地址')
      return
    }
    if (countdown > 0) return
    setSendingCode(true)
    setTopError('')
    try {
      await authApi.sendCode(regForm.email)
      setCountdown(60)
      showTopError('验证码已发送，请查收邮箱')
    } catch (e) {
      showTopError((e as Error).message)
    } finally {
      setSendingCode(false)
    }
  }

  // ── 注册 ──
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setTopError('')

    if (regForm.password !== regForm.confirmPassword) {
      showTopError('两次密码不一致')
      return
    }
    if (regForm.password.length < 8) {
      showTopError('密码至少 8 个字符')
      return
    }
    if (!regForm.code) {
      showTopError('请输入验证码')
      return
    }

    setRegistering(true)
    try {
      await authApi.register({
        username: regForm.username,
        password: regForm.password,
        confirm_password: regForm.confirmPassword,
        email: regForm.email,
        code: regForm.code,
      })
      // 注册成功，自动登录
      const ok = await login(regForm.username, regForm.password)
      if (ok) navigate('/')
      else showTopError('注册成功，请登录')
    } catch (e) {
      showTopError((e as Error).message)
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-primary px-4">
      {/* 固定宽度的认证卡片 */}
      <div className="w-[420px] flex flex-col">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-accent text-white font-bold text-2xl mb-3">
            AH
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">AI Hubs</h1>
          <p className="text-sm text-text-muted mt-1">新一代智能 Agent 平台</p>
        </div>

        {/* 顶部错误提示 */}
        {topError && (
          <div className="mb-4 px-4 py-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>{topError}</span>
          </div>
        )}

        {/* 卡片 */}
        <div className="card p-6">
          {/* Tab 切换 */}
          <div className="flex gap-1 mb-6 p-1 bg-bg-primary rounded-lg">
            <button
              onClick={() => { setTab('login'); setTopError('') }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'login' ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => { setTab('register'); setTopError('') }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'register' ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted'
              }`}
            >
              注册
            </button>
          </div>

          {/* 登录表单 */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">用户名</label>
                <input
                  className="input"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  placeholder="输入用户名"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">密码</label>
                <input
                  type="password"
                  className="input"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  placeholder="输入密码"
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : '登录'}
              </button>
            </form>
          )}

          {/* 注册表单 */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">用户名</label>
                <input
                  className="input"
                  value={regForm.username}
                  onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
                  placeholder="3-32位，字母数字下划线"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">邮箱</label>
                <input
                  className="input"
                  value={regForm.email}
                  onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  placeholder="your@email.com"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">验证码</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={regForm.code}
                    onChange={(e) => setRegForm({ ...regForm, code: e.target.value })}
                    placeholder="6位验证码"
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={countdown > 0 || sendingCode}
                    className="btn-secondary whitespace-nowrap text-sm"
                  >
                    {sendingCode ? <Loader2 size={14} className="animate-spin" /> :
                     countdown > 0 ? `${countdown}s` : '发送验证码'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">密码</label>
                <input
                  type="password"
                  className="input"
                  value={regForm.password}
                  onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                  placeholder="至少8位，含字母和数字"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">确认密码</label>
                <input
                  type="password"
                  className="input"
                  value={regForm.confirmPassword}
                  onChange={(e) => setRegForm({ ...regForm, confirmPassword: e.target.value })}
                  placeholder="再次输入密码"
                />
              </div>
              <button type="submit" disabled={registering} className="btn-primary w-full">
                {registering ? <Loader2 size={16} className="animate-spin mx-auto" /> : '注册'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-text-dim mt-6">
          默认管理员: admin / admin123
        </p>
      </div>
    </div>
  )
}
