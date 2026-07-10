// AI Hubs — API 客户端
// 基础请求封装 + 自动携带 JWT + 错误处理

const BASE = ''

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getToken(): string | null {
  return localStorage.getItem('ai_hubs_token')
}

function setToken(token: string | null) {
  if (token) {
    localStorage.setItem('ai_hubs_token', token)
  } else {
    localStorage.removeItem('ai_hubs_token')
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      msg = body.detail || body.message || body.error || msg
    } catch {
      /* 非 JSON 响应 */
    }
    // 401 → 清除 token，触发跳转登录
    if (res.status === 401) {
      setToken(null)
      window.location.href = '/login'
    }
    throw new ApiError(res.status, msg)
  }

  return res.json()
}

// ── 认证 API ──

export const authApi = {
  sendCode: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/v1/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  register: (data: {
    username: string
    password: string
    confirm_password: string
    email: string
    code: string
  }) =>
    request<{ ok: boolean; user: unknown; message: string }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (username: string, password: string) =>
    request<{
      access_token: string
      token_type: string
      user: import('../types').User
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () =>
    request<{ ok: boolean; user: import('../types').User }>('/api/v1/auth/me'),
}

// ── 系统 API ──

export const systemApi = {
  health: () =>
    request<{ status: string; version: string; database: string; db_available: boolean }>('/health'),
}

export { setToken, getToken, ApiError }
