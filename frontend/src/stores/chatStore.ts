// AI Hubs — 对话状态管理

import { create } from 'zustand'
import { conversationApi, streamChat, type Conversation, type ChatMessage, type SSEEvent, type AskQuestion } from '../api/chat'
import { uploadApi, chatContextApi, authApi, type Attachment } from '../api/client'
import { useThemeStore } from './themeStore'
import { useAuthStore } from './authStore'

/* ═══════════════════════════════════════════════════════════
   AI 通过 call_internal_api 触发的副作用（前端同步）
   
   思路：AI 修改了数据库资源后，前端其他页面（Agents/Tasks/Skills/...）
   不会自动重新拉取，导致"假完成" bug。
   
   方案：使用浏览器 CustomEvent 'ai-hubs:resource-changed' 作为事件总线，
   任何关心资源变更的组件（如 AgentsPage 监听 'agents'）可订阅并自动重新加载。
   
   这样所有资源的"AI 触发刷新"逻辑统一在一处，避免每加一个写操作都要改一遍前端。
   ═══════════════════════════════════════════════════════════ */

export const AI_MUTATION_EVENT = 'ai-hubs:resource-changed'

interface AIMutationDetail {
  /** 资源类型，如 'agents' / 'tasks' / 'skills' / 'memory' / 'datasets' / 'llm-config' / 'auth' */
  resource: string
  /** 操作类型 */
  method: string
  /** API 路径 */
  path: string
}

/** 派发 AI 资源变更事件 */
function dispatchAIMutation(detail: AIMutationDetail) {
  try {
    window.dispatchEvent(new CustomEvent(AI_MUTATION_EVENT, { detail }))
  } catch (e) {
    console.warn('[chat] failed to dispatch ai mutation event:', e)
  }
}

/** 监听 AI 资源变更事件的 hook（在 useEffect 里用） */
export function onAIMutation(handler: (detail: AIMutationDetail) => void): () => void {
  const wrapped = (e: Event) => handler((e as CustomEvent<AIMutationDetail>).detail)
  window.addEventListener(AI_MUTATION_EVENT, wrapped)
  return () => window.removeEventListener(AI_MUTATION_EVENT, wrapped)
}

interface MutationRule {
  /** 匹配 path 的正则（无 /api/v1 前缀也行，规则内兼容） */
  pattern: RegExp
  /** 哪些 HTTP 方法触发 */
  methods: string[]
  /** 资源类型名（用于事件） */
  resource: string
}

const MUTATION_RULES: MutationRule[] = [
  // 用户偏好 / 用户基本信息 → 'auth'
  { pattern: /\/auth\/me(\/|\?|$)/, methods: ['PUT', 'POST', 'PATCH', 'DELETE'], resource: 'auth' },
  // LLM 配置 → 'llm-config'
  { pattern: /\/llm\/config(\/|\?|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'], resource: 'llm-config' },
  // Agent CRUD
  { pattern: /\/agents(\/|\?|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'], resource: 'agents' },
  // 任务 CRUD + 执行/暂停/恢复
  { pattern: /\/tasks(\/|\?|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'], resource: 'tasks' },
  // 技能 CRUD + 安装/卸载
  { pattern: /\/skills(\/|\?|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'], resource: 'skills' },
  // 记忆提交/回滚
  { pattern: /\/memory\/(commit|rollback|clear|forget)/, methods: ['POST'], resource: 'memory' },
  // 数据集 CRUD
  { pattern: /\/datasets(\/|\?|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'], resource: 'datasets' },
  // 对话管理
  { pattern: /\/conversations(\/|\?|$)/, methods: ['POST', 'PUT', 'PATCH', 'DELETE'], resource: 'conversations' },
]

/** 检测 call_internal_api 影响的资源类型 */
function detectMutatedResources(path: string, method: string): string[] {
  const m = method.toUpperCase()
  const normalized = path.replace(/^\/api\/v1/, '')
  const matched = MUTATION_RULES
    .filter((rule) => rule.methods.includes(m) && rule.pattern.test(normalized))
    .map((rule) => rule.resource)
  return Array.from(new Set(matched))
}

/** 监听 AI 修改后：刷新 auth user + 主题（特殊处理，因为 themeStore/authStore 不订阅事件） */
async function reloadAuthUserOnMutation() {
  try {
    const res = await authApi.me()
    if (res?.ok && res.user) {
      useAuthStore.setState({ user: res.user })
      if (res.user.preferences) {
        useThemeStore.getState().initFromPreferences(res.user.preferences)
      }
    }
  } catch (e) {
    console.warn('[chat] reload auth user failed:', e)
  }
}

/** 从消息文本中提取 <ask>...</ask> 标签内容 */
function parseAskData(content: string): AskQuestion[] | undefined {
  const re = /<ask>\s*([\s\S]*?)\s*<\/ask>/gi
  const questions: AskQuestion[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    try {
      const q = JSON.parse(match[1])
      if (q && q.type && q.title) {
        questions.push(q as AskQuestion)
      }
    } catch { /* invalid JSON block — skip */ }
  }
  return questions.length > 0 ? questions : undefined
}

interface ContextUsage {
  model: string
  context_window: number
  used_tokens: number
  message_count: number
  usage_ratio: number
}

interface ChatState {
  conversations: Conversation[]
  currentConvId: string | null
  messages: ChatMessage[]
  streaming: boolean
  streamingContent: string
  error: string | null

  // 附件
  attachments: Attachment[]
  uploading: boolean

  // 上下文占用
  context: ContextUsage | null

  // 所选技能（从已安装技能中挑选，随对话发送）
  selectedSkills: string[]

  // 操作
  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  newConversation: () => void
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (text: string, agentName?: string | null, model?: string | null) => void
  clearError: () => void

  // 技能
  toggleSkill: (name: string) => void
  clearSkills: () => void

  // 附件
  addAttachments: (files: FileList | File[]) => Promise<{ ok: boolean; placeholder: string } | null>
  removeAttachment: (id: number) => void
  loadAttachments: (convId: string) => Promise<void>

  // 上下文
  refreshContext: () => Promise<void>

  // 对话队列（流式生成期间可排队，本轮结束后自动发送下一条）
  sendQueue: { text: string; agentName: string | null }[]
  enqueueMessage: (text: string, agentName?: string | null) => void
  removeQueued: (index: number) => void
  clearQueue: () => void

  // 暂停生成（中断 AI 思考，保留当前对话与已生成内容）
  pauseGeneration: () => void

  // 交互式提问回答
  submitAskAnswer: (messageIndex: number, answers: Record<string, string>) => void
}

// 当前流式请求的 AbortController（模块级，用于暂停/中断生成）
let activeController: AbortController | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConvId: null,
  messages: [],
  streaming: false,
  streamingContent: '',
  error: null,

  attachments: [],
  uploading: false,
  context: null,

  selectedSkills: [],
  sendQueue: [],

  loadConversations: async () => {
    try {
      const res = await conversationApi.list()
      set({ conversations: res.conversations || [] })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  selectConversation: async (id) => {
    set({ currentConvId: id, messages: [], error: null, attachments: [], selectedSkills: [], sendQueue: [] })
    try {
      const res = await conversationApi.messages(id)
      set({ messages: res.messages || [] })
      await get().loadAttachments(id)
      await get().refreshContext()
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  newConversation: () => {
    set({ currentConvId: null, messages: [], error: null, attachments: [], context: null, selectedSkills: [], sendQueue: [] })
  },

  deleteConversation: async (id) => {
    await conversationApi.delete(id)
    const { currentConvId, loadConversations } = get()
    if (currentConvId === id) {
      set({ currentConvId: null, messages: [], attachments: [] })
    }
    await loadConversations()
  },

  sendMessage: (text, agentName, model) => {
    const { currentConvId, attachments, selectedSkills } = get()
    const attachmentIds = attachments.map((a) => a.id)

    // 立即显示用户消息
    set((state) => ({
      messages: [...state.messages, { role: 'user', content: text }],
      streaming: true,
      streamingContent: '',
      error: null,
      attachments: [], // 发送后清空待发送附件
      // 注意：所选技能在本轮对话内持续生效（不清空），便于技能在连续对话中保持可用
    }))

    // 占位 AI 消息（流式填充），标记正在工作的 Agent 名
    set((state) => ({
      messages: [...state.messages, { role: 'assistant', content: '', agent_name: agentName ?? null }],
    }))

    // 本轮生成结束后，自动发送队列中的下一条
    const advanceQueue = () => {
      const q = [...get().sendQueue]
      if (q.length === 0) return
      const [next, ...rest] = q
      set({ sendQueue: rest })
      // 略微延迟，确保上一轮流式状态已落定
      setTimeout(() => get().sendMessage(next.text, next.agentName), 120)
    }

    const controller = streamChat(
      text,
      currentConvId,
      (evt: SSEEvent) => {
        switch (evt.event) {
          case 'start':
            if (evt.conversation_id && !get().currentConvId) {
              set({ currentConvId: evt.conversation_id })
            }
            break
          case 'delta':
            set((state) => {
              const msgs = [...state.messages]
              const last = msgs[msgs.length - 1]
              if (last && last.role === 'assistant') {
                msgs[msgs.length - 1] = {
                  ...last,
                  content: last.content + (evt.content || ''),
                }
              }
              return { messages: msgs, streamingContent: msgs[msgs.length - 1]?.content || '' }
            })
            break
          case 'tool_start':
            // 插入工具执行中消息
            set((state) => ({
              messages: [...state.messages, {
                role: 'tool' as const,
                content: '',
                tool_name: evt.name,
                tool_summary: evt.summary,
                tool_pending: true,
                tool_args: evt.args,  // 保存参数，供 tool_result 后副作用处理使用
              }],
            }))
            break
          case 'tool_result':
            // 更新最后一个 tool 消息的结果
            const mutatedResources = new Set<string>()
            let mutatedPath = ''
            let mutatedMethod = ''
            set((state) => {
              const msgs = [...state.messages]
              // 从后往前找最后一个 pending 的 tool 消息
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'tool' && msgs[i].tool_pending) {
                  let resultDisplay = ''
                  let parsed: any = null
                  try {
                    parsed = JSON.parse(evt.result || '{}')
                    if (parsed.stdout) resultDisplay = parsed.stdout.slice(0, 1000)
                    else if (parsed.ok !== undefined) resultDisplay = parsed.ok ? `✅ ${evt.name} 完成` : `❌ ${parsed.error || '失败'}`
                    else if (parsed.error) resultDisplay = `❌ ${parsed.error}`
                    else if (parsed.message) resultDisplay = parsed.message
                    else resultDisplay = evt.result?.slice(0, 500) || ''
                  } catch {
                    resultDisplay = evt.result?.slice(0, 500) || ''
                  }

                  // ── 副作用：检测 AI 是否通过 call_internal_api 修改了资源 → 派发全局事件 ──
                  if (msgs[i].tool_name === 'call_internal_api' && parsed?.ok === true) {
                    const args = msgs[i].tool_args || {}
                    const method = String(args.method || '').toUpperCase()
                    const path = String(args.path || '')
                    if (method && path) {
                      const resources = detectMutatedResources(path, method)
                      if (resources.length > 0) {
                        mutatedPath = path
                        mutatedMethod = method
                        resources.forEach((r) => mutatedResources.add(r))
                      }
                    }
                  }

                  msgs[i] = {
                    ...msgs[i],
                    tool_pending: false,
                    tool_result: resultDisplay,
                    // 不再把 "[工具: name] result" 拼到 content —— 避免 API 响应 JSON 污染消息文本
                    // ChatPage 渲染时直接用 tool_result 字段展示
                    content: resultDisplay,
                  }
                  return { messages: msgs }
                }
              }
              return { messages: msgs }
            })
            // 异步副作用：派发全局事件 + auth/llm 特殊处理
            if (mutatedResources.size > 0) {
              console.log(`[chat] AI mutation: ${mutatedMethod} ${mutatedPath} → resources:`, Array.from(mutatedResources))
              mutatedResources.forEach((resource) => {
                dispatchAIMutation({ resource, method: mutatedMethod, path: mutatedPath })
              })
              // auth 资源特殊处理：直接刷新 authStore + themeStore（其他资源由页面订阅事件刷新）
              if (mutatedResources.has('auth')) {
                reloadAuthUserOnMutation()
              }
            }
            break
          case 'interactive':
            // 插入交互式组件消息
            set((state) => ({
              messages: [...state.messages, {
                role: 'tool' as const,
                content: evt.title || evt.message || '',
                tool_name: 'request_user_input',
                tool_summary: evt.title,
                tool_pending: false,
                interactive: {
                  interaction_id: evt.interaction_id || '',
                  interaction_type: evt.interaction_type || 'confirm',
                  title: evt.title || '',
                  message: evt.message || '',
                  options: evt.options || [],
                  fields: evt.fields || [],
                  confirm_text: evt.confirm_text || '确认',
                  cancel_text: evt.cancel_text || '取消',
                },
                interactive_answered: false,
              }],
            }))
            break
          case 'done':
            // 解析最后一条 assistant 消息中的 <ask> 标签
            set((state) => {
              const msgs = [...state.messages]
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'assistant') {
                  const askData = parseAskData(msgs[i].content)
                  if (askData && askData.length > 0) {
                    msgs[i] = { ...msgs[i], ask_data: askData, ask_answered: false }
                    return { messages: msgs, streaming: false, streamingContent: '' }
                  }
                }
              }
              return { streaming: false, streamingContent: '' }
            })
            activeController = null
            get().loadConversations()
            if (get().currentConvId) get().refreshContext()
            advanceQueue()
            break
          case 'error':
            set({ streaming: false, error: evt.message || '未知错误' })
            activeController = null
            break
        }
      },
      (err: Error) => {
        set({ streaming: false, error: err.message })
        activeController = null
      },
      attachmentIds,
      selectedSkills,
      agentName ?? null,
      model ?? null,
    )
    activeController = controller
  },

  // 暂停生成：中断当前 AI 思考（abort 流），保留对话与已生成内容，不开启新对话
  pauseGeneration: () => {
    if (!activeController) return
    activeController.abort()
    activeController = null
    set({ streaming: false, streamingContent: '' })
  },

  // 对话队列：流式期间插入消息，本轮结束后自动发送
  enqueueMessage: (text, agentName = null) => {
    set((state) => ({ sendQueue: [...state.sendQueue, { text, agentName }] }))
  },
  removeQueued: (index) => {
    set((state) => ({ sendQueue: state.sendQueue.filter((_, i) => i !== index) }))
  },
  clearQueue: () => set({ sendQueue: [] }),

  // 交互式提问：提交答案后标记已答 + 发送答案给 AI
  submitAskAnswer: (messageIndex, answers) => {
    set((state) => {
      const msgs = [...state.messages]
      if (messageIndex < msgs.length) {
        msgs[messageIndex] = { ...msgs[messageIndex], ask_answered: true }
      }
      return { messages: msgs }
    })
    // 将答案格式化为用户消息发送
    const q = get().messages[messageIndex]
    const lines = ['【交互回答】']
    if (q?.ask_data) {
      for (const aq of q.ask_data) {
        const val = answers[aq.id]
        if (val) {
          lines.push(`${aq.title}: ${val}`)
        }
      }
    }
    if (lines.length > 1) {
      get().sendMessage(lines.join('\n'))
    }
  },

  clearError: () => set({ error: null }),

  toggleSkill: (name) => {
    set((state) => ({
      selectedSkills: state.selectedSkills.includes(name)
        ? state.selectedSkills.filter((s) => s !== name)
        : [...state.selectedSkills, name],
    }))
  },

  clearSkills: () => set({ selectedSkills: [] }),

  addAttachments: async (files): Promise<{ ok: boolean; placeholder: string } | null> => {
    const convId = get().currentConvId
    set({ uploading: true })
    let last: { ok: boolean; placeholder: string } | null = null
    try {
      for (const file of Array.from(files)) {
        const res = await uploadApi.upload(file, convId)
        if (res.ok) {
          set((state) => ({
            attachments: [...state.attachments, res.attachment],
          }))
          last = { ok: true, placeholder: res.placeholder }
        }
      }
    } catch (e: any) {
      set({ error: e?.message || '上传失败' })
    }
    set({ uploading: false })
    return last
  },

  removeAttachment: (id) => {
    set((state) => ({ attachments: state.attachments.filter((a) => a.id !== id) }))
    // 已上传到服务器的附件无需同步删除（重发不重复即可）
  },

  loadAttachments: async (convId) => {
    // 当前仅在发送前于本地维护待发送附件；历史附件可在消息中体现
    void convId
  },

  refreshContext: async () => {
    const convId = get().currentConvId
    try {
      const res = await chatContextApi.usage(convId)
      if (res.ok) set({ context: res })
    } catch { /* ignore */ }
  },
}))

// ── 键盘快捷键说明（供 UI 展示）──
export const CHAT_SHORTCUTS = [
  { keys: 'Enter', desc: '发送消息' },
  { keys: 'Shift+Enter', desc: '换行' },
  { keys: '↑ / ↓', desc: '回溯 / 前进历史消息' },
  { keys: '← / →', desc: '移动光标' },
  { keys: 'Ctrl+K', desc: '聚焦输入框' },
  { keys: 'Ctrl+F', desc: '搜索对话' },
  { keys: 'Ctrl+L', desc: '清屏（新对话）' },
  { keys: 'Ctrl+C', desc: '复制选中 / 中断生成' },
]
