// AI Hubs — API 客户端
// 基础请求封装 + 自动携带 JWT + 错误处理

import type { User } from '../types'

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
    ...(options.headers as Record<string, string>),
  }
  // body 为 FormData 时让浏览器自动设置 multipart boundary
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
  }

  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // 统一前缀：业务接口都挂在 /api/v1 下；特殊根级路径（/health）保持不变。
  // 已带 /api/ 前缀的（如 /api/v1/auth/login）不再重复添加。
  let urlPath = path
  if (!urlPath.startsWith('/api/') && urlPath !== '/health') {
    urlPath = `/api/v1${urlPath.startsWith('/') ? '' : '/'}${urlPath}`
  }

  const res = await fetch(`${BASE}${urlPath}`, { ...options, headers })

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      const raw = body.detail ?? body.message ?? body.error
      if (Array.isArray(raw)) {
        // FastAPI 422 校验错误：detail 是错误对象数组
        msg = raw
          .map((e: { loc?: unknown[]; msg?: string }) =>
            e && typeof e === "object" && "msg" in e
              ? String((e as { msg?: string }).msg)
              : String(e)
          )
          .join("；")
      } else if (raw !== undefined && raw !== null) {
        msg = typeof raw === "string" ? raw : JSON.stringify(raw)
      }
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

  // 204 No Content 或空响应体：不解析 JSON，避免 "Unexpected end of JSON input"
  if (res.status === 204) {
    return {} as T
  }
  const text = await res.text()
  if (!text) {
    return {} as T
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
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

  updateMe: (data: { username?: string; email?: string; preferences?: Record<string, unknown> }) =>
    request<{ ok: boolean; user: import('../types').User }>('/api/v1/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}

// ── 系统 API ──

export const systemApi = {
  health: () =>
    request<{ status: string; version: string; database: string; db_available: boolean }>('/health'),
}

// ── 仪表盘 API ──

export interface DashboardStats {
  agents: number
  running_tasks: number
  memory_entries: number
  datasets: number
}

export const dashboardApi = {
  stats: () => request<DashboardStats>('/dashboard'),
}

// ── 效率测试板 API（议题 #15：速度 / 消耗 / 成本 / 协调效率）──

export interface EfficiencySummaryRow {
  mode: string
  count: number
  success_rate: number
  avg_latency_s: number
  avg_cost_usd: number
  avg_in_tokens: number
  avg_out_tokens: number
  avg_agents: number
  avg_rounds: number | null
}

export interface EfficiencyReport {
  task_id: string
  mode: string
  model: string
  agents: number
  latency_s: number
  in_tokens: number
  out_tokens: number
  cost_usd: number
  success: boolean
  rounds: number | null
  created_at: string
}

export const efficiencyApi = {
  summary: () => api.get<EfficiencySummaryRow[]>('/efficiency/summary'),
  reports: (limit = 200, mode?: string) =>
    api.get<EfficiencyReport[]>(
      `/efficiency/reports?limit=${limit}${mode ? `&mode=${encodeURIComponent(mode)}` : ''}`,
    ),
}

// ── 通用 API 封装 ──

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  form: <T>(path: string, formData: FormData) =>
    request<T>(path, {
      method: 'POST',
      body: formData,
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

// ── Agent API ──

export interface Agent {
  id: number
  name: string
  description: string
  system_prompt: string | null
  model: string
  provider: string
  config_mode: 'global' | 'self'
  is_default: boolean
  enable_planning: boolean
  enable_rag: boolean
  enable_reflection: boolean
  max_iterations: number
  memory_strength: number
  setup_mode: string
  skills: string[]
  tags: string[]
  category: string
  status: string
  current_task_id: string | null
  created_at: string | null
}

export interface AgentAnalyzeResult {
  ok: boolean
  suggested_skills: string[]
  suggested_tags: string[]
  category: string
  system_prompt_draft: string
}

export const agentApi = {
  list: () => api.get<Agent[]>('/agents'),
  get: (id: number) => api.get<Agent>(`/agents/${id}`),
  create: (data: Partial<Agent> & { name: string }) => api.post<Agent>('/agents', data),
  update: (id: number, data: Partial<Agent>) => api.put<Agent>(`/agents/${id}`, data),
  remove: (id: number) => api.delete(`/agents/${id}`),
  analyze: (data: { name: string; description?: string; available_skills?: string[] }) =>
    api.post<AgentAnalyzeResult>('/agents/analyze', data),
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
    return api.get<Skill[]>(`/api/v1/skills${q ? `?${q}` : ''}`)
  },
  get: (id: number) => api.get<Skill>(`/api/v1/skills/${id}`),
  create: (data: { name: string; description?: string; category?: string; entry?: string; code?: string; config?: Record<string, unknown> }) =>
    api.post<Skill>('/api/v1/skills', data),
  update: (id: number, data: Partial<{ name: string; description: string; category: string; entry: string; code: string; config: Record<string, unknown> }>) =>
    api.put<Skill>(`/api/v1/skills/${id}`, data),
  remove: (id: number) => api.delete(`/api/v1/skills/${id}`),
  install: (id: number) => api.post<Skill>(`/api/v1/skills/${id}/install`),
  uninstall: (id: number) => api.post<Skill>(`/api/v1/skills/${id}/uninstall`),
  marketGithub: (q: string, page = 1) =>
    api.get<{ query: string; total: number; items: GithubSkill[]; error: string | null }>(
      `/api/v1/skills/market/github?q=${encodeURIComponent(q)}&page=${page}`
    ),
  marketInstall: (data: { full_name: string; html_url?: string; description?: string; branch?: string; path?: string; category?: string }) =>
    api.post<Skill>('/api/v1/skills/market/install', data),
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
  updateRecord: (id: number, recordId: number, data: Record<string, unknown>) =>
    api.put<DatasetRecord>(`/datasets/${id}/records/${recordId}`, { data }),
  deleteRecord: (id: number, recordId: number) => api.delete(`/datasets/${id}/records/${recordId}`),
  batchDelete: (id: number, ids: number[]) =>
    api.post(`/datasets/${id}/records/batch-delete`, { ids }),
  search: (id: number, q: string, limit = 100, offset = 0) =>
    api.get<DatasetRecord[]>(`/datasets/${id}/records/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`),
  importRecords: (id: number, format: 'json' | 'csv', content: string) =>
    api.post<{ inserted: number; skipped: number; total_records: number }>(`/datasets/${id}/import`, { format, content }),
  exportRecords: (id: number, format: 'json' | 'csv' = 'json') =>
    api.get<{ dataset_id: number; name: string; format: string; content: string }>(`/datasets/${id}/export?format=${format}`),
}

// ── 后台管理 API（仅管理员） ──

export interface AdminDashboard {
  users: { total: number; active: number; admins: number; recent_7d: number }
  agents: { total: number }
  skills: { total: number; by_source: Record<string, number> }
  datasets: { total: number }
  tasks: { total: number }
  conversations: { total: number }
  messages: { total: number }
  latest_users: User[]
}

export interface AdminUser {
  id: number
  username: string
  email: string
  role: string
  is_active: boolean
  preferences: Record<string, unknown>
  token_quota: number | null
  token_used: number
  created_at: string | null
  last_login_at: string | null
}

export interface AdminUserList {
  items: AdminUser[]
  total: number
  page: number
  page_size: number
}

export interface AdminUserUpdate {
  email?: string
  role?: 'admin' | 'user'
  is_active?: boolean
  token_quota?: number
}

// ── 后台 Agent 管理 ──

export interface AdminAgent extends Agent {
  owner_username: string
  owner_id: number
}

export interface AdminAgentList {
  items: AdminAgent[]
  total: number
  page: number
  page_size: number
}

// ── 后台 Skill 管理 ──

export interface AdminSkillList {
  items: Skill[]
  total: number
  page: number
  page_size: number
}

export const adminApi = {
  dashboard: () => api.get<AdminDashboard>('/admin/dashboard'),

  // 用户管理
  listUsers: (params?: { page?: number; page_size?: number; search?: string }) => {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.page_size) qs.set('page_size', String(params.page_size))
    if (params?.search) qs.set('search', params.search)
    const q = qs.toString()
    return api.get<AdminUserList>(`/admin/users${q ? `?${q}` : ''}`)
  },
  getUser: (id: number) => api.get<AdminUser>(`/admin/users/${id}`),
  updateUser: (id: number, data: AdminUserUpdate) => api.put<AdminUser>(`/admin/users/${id}`, data),
  deleteUser: (id: number) => api.delete(`/admin/users/${id}`),
  setUserQuota: (id: number, token_quota: number) =>
    api.put<AdminUser>(`/admin/users/${id}/quota`, { token_quota }),
  resetUserUsage: (id: number) =>
    api.post<AdminUser>(`/admin/users/${id}/reset-usage`),

  // Agent 管理
  listAgents: (params?: { page?: number; page_size?: number; search?: string; user_id?: number }) => {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.page_size) qs.set('page_size', String(params.page_size))
    if (params?.search) qs.set('search', params.search)
    if (params?.user_id) qs.set('user_id', String(params.user_id))
    const q = qs.toString()
    return api.get<AdminAgentList>(`/admin/agents${q ? `?${q}` : ''}`)
  },
  updateAgent: (id: number, data: Partial<Agent>) => api.put<AdminAgent>(`/admin/agents/${id}`, data),
  deleteAgent: (id: number) => api.delete(`/admin/agents/${id}`),
  copyAgent: (id: number, target_user_id: number, new_name?: string) =>
    api.post<{ ok: boolean; agent: Agent; message: string }>(`/admin/agents/${id}/copy`, { target_user_id, new_name }),

  // 技能管理
  listSkills: (params?: { page?: number; page_size?: number; search?: string; source?: string }) => {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.page_size) qs.set('page_size', String(params.page_size))
    if (params?.search) qs.set('search', params.search)
    if (params?.source) qs.set('source', params.source)
    const q = qs.toString()
    return api.get<AdminSkillList>(`/admin/skills${q ? `?${q}` : ''}`)
  },
  createSkill: (data: Partial<Skill> & { name: string }) => api.post<Skill>('/admin/skills', data),
  updateSkill: (id: number, data: Partial<Skill>) => api.put<Skill>(`/admin/skills/${id}`, data),
  deleteSkill: (id: number) => api.delete(`/admin/skills/${id}`),
  syncSkill: (id: number, action = 'refresh') => api.post<Skill>(`/admin/skills/${id}/sync`, { action }),
  batchSyncSkills: () => api.post<{ ok: boolean; synced: number; total: number }>('/admin/skills/batch-sync'),
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

export interface WorkspaceUsage {
  used: number
  quota: number
}

export interface RunResult {
  stdout: string
  stderr: string
  exit_code: number
  timed_out: boolean
  command: string
}

export const ideApi = {
  tree: () => api.get<{ tree: FsNode; usage: WorkspaceUsage }>('/api/v1/ide/tree'),
  readFile: (path: string) => api.get<{ path: string; name: string; content: string; size: number }>(`/api/v1/ide/file?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) => api.post<{ path: string; name: string; size: number }>('/api/v1/ide/file', { path, content }),
  mkdir: (path: string) => api.post<{ path: string; type: string }>('/api/v1/ide/mkdir', { path }),
  deleteFile: (path: string) => api.delete(`/api/v1/ide/file?path=${encodeURIComponent(path)}`),
  run: (path: string, args: string[] = []) => api.post<RunResult>('/api/v1/ide/run', { path, args }),
  // 文件上传（二进制，多 part）
  upload: (path: string, file: File) => {
    const form = new FormData()
    form.append('path', path)
    form.append('file', file)
    return fetch('/api/v1/ide/files/upload', {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${getToken()}` },
    }).then(r => r.json())
  },
  // 文件信息（mime/大小/是否文本等）
  fileInfo: (path: string) => api.get<{
    path: string; name: string; size: number; ext: string; mime: string;
    is_text: boolean; is_image: boolean; is_pdf: boolean; is_media: boolean;
  }>(`/api/v1/ide/files/info?path=${encodeURIComponent(path)}`),
  // 预览（直接内嵌 URL，自动附加 token 参数用于鉴权）
  previewUrl: (path: string, inline: boolean = true) => {
    const token = getToken() || ''
    return `/api/v1/ide/files/preview?path=${encodeURIComponent(path)}&inline=${inline}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  },
  // 下载 URL（自动附加 token 参数用于鉴权）
  downloadUrl: (path: string) => {
    const token = getToken() || ''
    return `/api/v1/ide/files/download?path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  },
}

// ── 附件上传 API ──

export interface Attachment {
  id: number
  conversation_id: string | null
  ref_index: number
  kind: 'image' | 'doc' | 'file'
  filename: string
  mime_type: string | null
  size: number
  url: string
  created_at: string | null
}

export const uploadApi = {
  upload: (file: File, conversationId: string | null) => {
    const form = new FormData()
    form.append('file', file)
    if (conversationId) form.append('conversation_id', conversationId)
    return request<{ ok: boolean; attachment: Attachment; placeholder: string; kind: string }>(
      '/api/v1/uploads', { method: 'POST', body: form, headers: {} }
    )
  },
  remove: (id: number) => api.delete(`/api/v1/uploads/${id}`),
}

// ── 上下文占用 API ──

export const chatContextApi = {
  usage: (conversationId: string | null) =>
    api.get<{
      ok: boolean; model: string; context_window: number;
      used_tokens: number; message_count: number; usage_ratio: number
    }>(`/api/v1/chat/context-usage${conversationId ? `?conversation_id=${conversationId}` : ''}`),
}

export { setToken, getToken, ApiError }
