// ============================================================
// AI Hubs Frontend — API 客户端
// ============================================================

const BASE = '';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

// ── 对话 ──

export function chatStream(
  message: string,
  onEvent: (event: Record<string, unknown>) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              onEvent(evt);
            } catch { /* ignore malformed */ }
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return controller;
}

// ── 编排任务 (SSE 流式) ──

export function orchestrateStream(
  description: string,
  title: string,
  mode: string,
  agentNames: string[] | null,
  onEvent: (event: Record<string, unknown>) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch('/api/tasks/orchestrate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, title, mode, agent_names: agentNames }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              onEvent(evt);
            } catch { /* ignore */ }
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return controller;
}

// ── 任务管理 ──

export const tasksApi = {
  list: (status = '', limit = 20) =>
    request<{ ok: boolean; tasks: import('../types').TaskInfo[]; queue: import('../types').QueueStatus }>(
      `/api/tasks/list?status=${status}&limit=${limit}`
    ),
  get: (id: string) =>
    request<{ ok: boolean; task: import('../types').TaskInfo }>(`/api/tasks/${id}`),
  publish: (description: string, title: string, priority = 0, tags: string[] = [], targetAgent = '') =>
    request<{ ok: boolean; task_id: string }>('/api/tasks/publish', {
      method: 'POST',
      body: JSON.stringify({ description, title, priority, tags, target_agent: targetAgent }),
    }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  pause: (id: string) =>
    request<{ ok: boolean; message?: string }>(`/api/tasks/${id}/pause`, { method: 'POST' }),
  resume: (id: string) =>
    request<{ ok: boolean; message?: string }>(`/api/tasks/${id}/resume`, { method: 'POST' }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
  detectMode: (description: string) =>
    request<{ ok: boolean; mode: string; reason: string }>('/api/tasks/detect-mode', {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),
  getModes: () =>
    request<{ ok: boolean; modes: import('../types').OrchestrationMode[] }>('/api/tasks/orchestrate/modes'),
};

// ── Agent 管理 ──

export const agentsApi = {
  list: () =>
    request<{ ok: boolean; agents: import('../types').AgentInfo[] }>('/api/agents/list'),
  create: (data: Record<string, unknown>) =>
    request<{ ok: boolean; agent: import('../types').AgentInfo }>('/api/agents/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (name: string, data: Record<string, unknown>) =>
    request<{ ok: boolean; agent: import('../types').AgentInfo }>(`/api/agents/${name}/update`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (name: string) =>
    request<{ ok: boolean }>(`/api/agents/${name}`, { method: 'DELETE' }),
  getConfig: (name: string) =>
    request<{ ok: boolean; config: Record<string, unknown> }>(`/api/agents/${name}/config`),
};

// ── 知识库 ──

export const knowledgeApi = {
  files: () =>
    request<{ ok: boolean; total_chunks: number; total_sources: number; sources: import('../types').KnowledgeSource[] }>('/api/knowledge/files'),
  stats: () =>
    request<{ ok: boolean; chunks: number; sources: number }>('/api/knowledge/stats'),
  search: (q: string, topK = 5) =>
    request<{ ok: boolean; query: string; results: unknown[] }>(`/api/knowledge/search?q=${encodeURIComponent(q)}&top_k=${topK}`),
  upload: async (files: FileList) => {
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) {
      fd.append('files', files[i]);
    }
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: fd });
    return res.json();
  },
  clear: () =>
    request<{ ok: boolean }>('/api/knowledge/clear', { method: 'DELETE' }),
  deleteSource: (sourceId: string) =>
    request<{ ok: boolean }>(`/api/knowledge/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }),
};

// ── 配置 ──

export const configApi = {
  get: () =>
    request<{ model: string; provider: string; tools: number; planning: boolean; rag: boolean; reflection: boolean; langchain: boolean; models: import('../types').ModelInfo[] }>('/api/config'),
  switchModel: (model: string, provider?: string) =>
    request<{ ok: boolean }>('/api/switch_model', {
      method: 'POST',
      body: JSON.stringify({ model, provider }),
    }),
  toggleMode: (mode: string) =>
    request<{ ok: boolean; mode: string; enabled: boolean }>('/api/toggle_mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  updateLLM: (provider: string, model: string, apiKey: string, baseUrl: string) =>
    request<{ ok: boolean }>('/api/config/llm', {
      method: 'POST',
      body: JSON.stringify({ provider, model, api_key: apiKey, base_url: baseUrl }),
    }),
  getFull: () =>
    request<{ ok: boolean; config: Record<string, unknown> }>('/api/config/full'),
};

// ── 系统 ──

export const systemApi = {
  info: () =>
    request<{ ok: boolean; system: import('../types').SystemInfo; database: string; agent: Record<string, string> }>('/api/system/info'),
  health: () =>
    request<{ status: string; version: string; checks: Record<string, string> }>('/health'),
  tools: () =>
    request<{ ok: boolean; tools: { name: string; description: string; parameters: string[]; dangerous: boolean }[]; count: number }>('/api/tools'),
};

// ── 认证 ──

export const authApi = {
  login: (username: string, password: string) =>
    request<{ ok: boolean; access_token?: string; token_type?: string; user?: Record<string, unknown>; error?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  sendCode: (email: string) =>
    request<{ ok: boolean; message?: string; error?: string }>('/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  register: (username: string, password: string, confirmPassword: string, email: string, code: string) =>
    request<{ ok: boolean; user?: Record<string, unknown>; message?: string; error?: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, confirm_password: confirmPassword, email, code }),
    }),
  me: () =>
    request<{ ok: boolean; user?: Record<string, unknown> }>('/api/auth/me'),
};

// ── 技能市场 ──

export const skillsApi = {
  list: (category = '', installedOnly = false) =>
    request<{ ok: boolean; skills: import('../types').SkillInfo[]; categories: { id: string; name: string; count: number }[] }>(
      `/api/skills/list?category=${encodeURIComponent(category)}&installed_only=${installedOnly}`
    ),
  get: (id: string) =>
    request<{ ok: boolean; skill: import('../types').SkillInfo }>(`/api/skills/${encodeURIComponent(id)}`),
  install: (id: string) =>
    request<{ ok: boolean; message: string }>(`/api/skills/${encodeURIComponent(id)}/install`, { method: 'POST' }),
  uninstall: (id: string) =>
    request<{ ok: boolean; message: string }>(`/api/skills/${encodeURIComponent(id)}/uninstall`, { method: 'POST' }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  create: (data: Record<string, unknown>) =>
    request<{ ok: boolean; skill: import('../types').SkillInfo }>('/api/skills/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  searchGitHub: (q: string, category = '', page = 1) =>
    request<{ ok: boolean; skills: import('../types').SkillInfo[]; total: number }>(
      `/api/skills/github/search?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&page=${page}`
    ),
  importFromGitHub: (data: Record<string, unknown>) =>
    request<{ ok: boolean; skill: import('../types').SkillInfo }>('/api/skills/github/import', {
      method: 'POST',
      body: JSON.stringify({ data }),
    }),
  categories: () =>
    request<{ ok: boolean; categories: { id: string; name: string; count: number }[] }>('/api/skills/categories/list'),
};

// ── 记忆管理 ──

export const memoryApi = {
  stats: () =>
    request<{ ok: boolean; short_term: { message_count: number }; vcs: { commit_count: number; head: string }; graph: { node_count: number; edge_count: number } }>(
      '/api/memory/stats'
    ),
  vcsLog: (limit = 20) =>
    request<{ ok: boolean; commits: { id: string; message: string; timestamp: string; messages_count: number; messages_summary: string }[]; total: number }>(
      `/api/memory/vcs/log?limit=${limit}`
    ),
  vcsCommit: (message = '') =>
    request<{ ok: boolean; commit_id: string; message: string }>('/api/memory/vcs/commit', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  vcsCheckout: (commitId: string) =>
    request<{ ok: boolean; message: string }>('/api/memory/vcs/checkout', {
      method: 'POST',
      body: JSON.stringify({ commit_id: commitId }),
    }),
  vcsDiff: (commit1: string, commit2: string) =>
    request<{ ok: boolean; diff: { added: string[]; removed: string[]; count_before: number; count_after: number } }>(
      '/api/memory/vcs/diff',
      { method: 'POST', body: JSON.stringify({ commit1, commit2 }) }
    ),
  graphData: () =>
    request<{ ok: boolean; graph: { nodes: { id: string; label: string; role: string; keywords: string[] }[]; links: { source: string; target: string }[] }; node_count: number; edge_count: number }>(
      '/api/memory/graph/visualize'
    ),
  graphClusters: () =>
    request<{ ok: boolean; clusters: { keywords: string[]; nodes: string[]; size: number }[] }>('/api/memory/graph/clusters'),
  recall: (query: string, n = 5) =>
    request<{ ok: boolean; result: string }>('/api/memory/recall', {
      method: 'POST',
      body: JSON.stringify({ query, n }),
    }),
  compress: () =>
    request<{ ok: boolean; summary: string }>('/api/memory/compress', { method: 'POST' }),
};
