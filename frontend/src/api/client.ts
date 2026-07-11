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

// ── 通用 API 封装 ──

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  put: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// ── 技能市场 API ──

export interface Skill {
  id: number
  name: string
  description: string
  category: string
  source: 'builtin' | 'github' | 'custom'
  github_url: string | null
  version: string
  config: Record<string, unknown>
  is_installed: boolean
  installed_at: string | null
  created_at: string | null
}

export interface GithubSkill {
  full_name: string
  name: string
  description: string
  html_url: string
  stars: number
  language: string | null
  default_branch: string
}

export const skillApi = {
  list: (params?: { source?: string; category?: string; search?: string; installed?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.source) qs.set('source', params.source)
    if (params?.category) qs.set('category', params.category)
    if (params?.search) qs.set('search', params.search)
    if (params?.installed !== undefined) qs.set('installed', String(params.installed))
    const q = qs.toString()
    return api.get<Skill[]>(`/skills${q ? `?${q}` : ''}`)
  },
  get: (id: number) => api.get<Skill>(`/skills/${id}`),
  create: (data: { name: string; description?: string; category?: string; entry?: string; code?: string; config?: Record<string, unknown> }) =>
    api.post<Skill>('/skills', data),
  update: (id: number, data: Partial<{ name: string; description: string; category: string; entry: string; code: string; config: Record<string, unknown> }>) =>
    api.put<Skill>(`/skills/${id}`, data),
  remove: (id: number) => api.delete(`/skills/${id}`),
  install: (id: number) => api.post<Skill>(`/skills/${id}/install`),
  uninstall: (id: number) => api.post<Skill>(`/skills/${id}/uninstall`),
  marketGithub: (q: string, page = 1) =>
    api.get<{ query: string; total: number; items: GithubSkill[]; error: string | null }>(
      `/skills/market/github?q=${encodeURIComponent(q)}&page=${page}`
    ),
  marketInstall: (data: { full_name: string; html_url?: string; description?: string; branch?: string; path?: string; category?: string }) =>
    api.post<Skill>('/skills/market/install', data),
}

// ── 数据集 API ──

export interface Dataset {
  id: number
  name: string
  description: string
  category: string
  schema: Record<string, unknown>
  record_count: number
  created_at: string | null
  updated_at: string | null
}

export interface DatasetRecord {
  id: number
  dataset_id: number
  data: Record<string, unknown>
  created_at: string | null
}

export const datasetApi = {
  list: () => api.get<Dataset[]>('/datasets'),
  get: (id: number) => api.get<Dataset>(`/datasets/${id}`),
  create: (data: { name: string; description?: string; category?: string; schema?: Record<string, unknown> }) =>
    api.post<Dataset>('/datasets', data),
  update: (id: number, data: Partial<{ name: string; description: string; category: string; schema: Record<string, unknown> }>) =>
    api.put<Dataset>(`/datasets/${id}`, data),
  remove: (id: number) => api.delete(`/datasets/${id}`),
  records: (id: number, limit = 100, offset = 0) =>
    api.get<DatasetRecord[]>(`/datasets/${id}/records?limit=${limit}&offset=${offset}`),
  addRecord: (id: number, data: Record<string, unknown>) =>
    api.post<DatasetRecord>(`/datasets/${id}/records`, { data }),
  deleteRecord: (id: number, recordId: number) => api.delete(`/datasets/${id}/records/${recordId}`),
  importRecords: (id: number, format: 'json' | 'csv', content: string) =>
    api.post<{ inserted: number; skipped: number; total_records: number }>(`/datasets/${id}/import`, { format, content }),
  exportRecords: (id: number, format: 'json' | 'csv' = 'json') =>
    api.get<{ dataset_id: number; name: string; format: string; content: string }>(`/datasets/${id}/export?format=${format}`),
}

// ── IDE API ──

export interface FsNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FsNode[]
  truncated?: boolean
}

export interface RunResult {
  stdout: string
  stderr: string
  exit_code: number
  timed_out: boolean
  command: string
}

export const ideApi = {
  tree: () => api.get<FsNode>('/ide/tree'),
  readFile: (path: string) => api.get<{ path: string; name: string; content: string; size: number }>(`/ide/file?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) => api.post<{ path: string; name: string; size: number }>('/ide/file', { path, content }),
  mkdir: (path: string) => api.post<{ path: string; type: string }>('/ide/mkdir', { path }),
  deleteFile: (path: string) => api.delete(`/ide/file?path=${encodeURIComponent(path)}`),
  run: (path: string, args: string[] = []) => api.post<RunResult>('/ide/run', { path, args }),
}

export { setToken, getToken, ApiError }
