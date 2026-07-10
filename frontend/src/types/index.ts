// AI Hubs — 类型定义

export interface User {
  id: number
  username: string
  email: string
  role: 'admin' | 'user'
  is_active: boolean
  preferences: Record<string, unknown>
  created_at: string | null
  last_login_at: string | null
}

export interface LoginResponse {
  access_token: string
  token_type: string
  user: User
}

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  message?: string
}
