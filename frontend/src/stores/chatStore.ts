// AI Hubs — 对话状态管理

import { create } from 'zustand'
import { conversationApi, streamChat, type Conversation, type ChatMessage, type SSEEvent, type AskQuestion } from '../api/chat'
import { uploadApi, chatContextApi, type Attachment } from '../api/client'

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
              }],
            }))
            break
          case 'tool_result':
            // 更新最后一个 tool 消息的结果
            set((state) => {
              const msgs = [...state.messages]
              // 从后往前找最后一个 pending 的 tool 消息
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'tool' && msgs[i].tool_pending) {
                  let resultDisplay = ''
                  try {
                    const r = JSON.parse(evt.result || '{}')
                    if (r.stdout) resultDisplay = r.stdout.slice(0, 1000)
                    else if (r.ok !== undefined) resultDisplay = r.ok ? `✅ ${evt.name} 完成` : `❌ ${r.error || '失败'}`
                    else if (r.error) resultDisplay = `❌ ${r.error}`
                    else if (r.message) resultDisplay = r.message
                    else resultDisplay = evt.result?.slice(0, 500) || ''
                  } catch {
                    resultDisplay = evt.result?.slice(0, 500) || ''
                  }
                  msgs[i] = {
                    ...msgs[i],
                    tool_pending: false,
                    tool_result: resultDisplay,
                    content: `[${evt.name}] ${resultDisplay}`,
                  }
                  return { messages: msgs }
                }
              }
              return { messages: msgs }
            })
            break
          case 'interactive':
            // 插入交互式组件消息
            set((state) => ({
              messages: [...state.messages, {
                role: 'tool' as const,
                content: `[询问] ${evt.title}`,
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
