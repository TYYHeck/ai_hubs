// AI Hubs — 对话 API 客户端（含 SSE 流式处理）

import { getToken } from './client'

export interface AskQuestion {
  id: string
  type: 'choice' | 'multiselect' | 'text' | 'confirm'
  title: string
  options?: string[]         // choice / multiselect
  placeholder?: string       // text
  default?: string           // text 默认值
  yes?: string               // confirm 确认按钮文字
  no?: string                // confirm 取消按钮文字
}

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  think_content?: string | null
  agent_name?: string | null
  created_at?: string | null
  // 工具调用相关
  tool_name?: string
  tool_summary?: string
  tool_result?: string
  tool_pending?: boolean  // 工具正在执行
  // 交互式提问（<ask> 标签）
  ask_data?: AskQuestion[]     // 从 <ask> 标签中解析出的问题
  ask_answered?: boolean       // 用户是否已回答
  // 交互式组件（request_user_input 工具）
  interactive?: {
    interaction_id: string
    interaction_type: 'confirm' | 'select' | 'multi_select' | 'form'
    title: string
    message: string
    options?: { label: string; value: string; description?: string }[]
    fields?: { name: string; label: string; type: string; placeholder?: string; required?: boolean; options?: { label: string; value: string }[]; default?: string }[]
    confirm_text?: string
    cancel_text?: string
  }
  interactive_answered?: boolean
}

export interface Conversation {
  id: string
  title: string
  agent_name: string | null
  model: string
  created_at: string | null
  updated_at: string | null
}

export interface SSEEvent {
  event: 'start' | 'delta' | 'think' | 'done' | 'error' | 'tool_start' | 'tool_result'
  conversation_id?: string
  content?: string
  message_id?: number
  message?: string
  // 工具事件
  name?: string
  summary?: string
  args?: Record<string, unknown>
  result?: string
  tools_enabled?: boolean
}

// ── 对话管理 ──

export const conversationApi = {
  list: async (): Promise<{ ok: boolean; conversations: Conversation[] }> => {
    const res = await fetch('/api/v1/conversations', {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    return res.json()
  },

  create: async (title: string): Promise<{ ok: boolean; conversation: Conversation }> => {
    const res = await fetch('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ title }),
    })
    return res.json()
  },

  delete: async (id: string): Promise<{ ok: boolean }> => {
    const res = await fetch(`/api/v1/conversations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    return res.json()
  },

  messages: async (id: string): Promise<{ ok: boolean; messages: ChatMessage[] }> => {
    const res = await fetch(`/api/v1/conversations/${id}/messages`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    return res.json()
  },
}

// ── SSE 流式对话 ──

export function streamChat(
  message: string,
  conversationId: string | null,
  onEvent: (evt: SSEEvent) => void,
  onError: (err: Error) => void,
  attachmentIds: number[] = [],
  skills: string[] = [],
  agentName: string | null = null,
  model: string | null = null,
): AbortController {
  const controller = new AbortController()

  fetch('/api/v1/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      attachment_ids: attachmentIds,
      skills,
      agent_name: agentName,
      model: model || undefined,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6))
              onEvent(evt)
            } catch { /* ignore malformed */ }
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err)
    })

  return controller
}

// ── LLM 配置 ──

export const llmApi = {
  getConfig: async () => {
    const res = await fetch('/api/v1/llm/config', {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    return res.json()
  },

  updateConfig: async (data: {
    provider: string
    model: string
    api_key: string
    base_url?: string
    temperature?: number
    max_tokens?: number
  }) => {
    const res = await fetch('/api/v1/llm/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(data),
    })
    return res.json()
  },

  getProviders: async () => {
    const res = await fetch('/api/v1/llm/providers', {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    return res.json()
  },
}
