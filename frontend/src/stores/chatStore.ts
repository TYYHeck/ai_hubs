// AI Hubs — 对话状态管理

import { create } from 'zustand'
import { conversationApi, streamChat, type Conversation, type ChatMessage, type SSEEvent } from '../api/chat'

interface ChatState {
  conversations: Conversation[]
  currentConvId: string | null
  messages: ChatMessage[]
  streaming: boolean
  streamingContent: string
  error: string | null

  // 操作
  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  newConversation: () => void
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (text: string) => void
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConvId: null,
  messages: [],
  streaming: false,
  streamingContent: '',
  error: null,

  loadConversations: async () => {
    try {
      const res = await conversationApi.list()
      set({ conversations: res.conversations || [] })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  selectConversation: async (id) => {
    set({ currentConvId: id, messages: [], error: null })
    try {
      const res = await conversationApi.messages(id)
      set({ messages: res.messages || [] })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  newConversation: () => {
    set({ currentConvId: null, messages: [], error: null })
  },

  deleteConversation: async (id) => {
    await conversationApi.delete(id)
    const { currentConvId, loadConversations } = get()
    if (currentConvId === id) {
      set({ currentConvId: null, messages: [] })
    }
    await loadConversations()
  },

  sendMessage: (text) => {
    const { currentConvId } = get()

    // 立即显示用户消息
    set((state) => ({
      messages: [...state.messages, { role: 'user', content: text }],
      streaming: true,
      streamingContent: '',
      error: null,
    }))

    // 占位 AI 消息（流式填充）
    set((state) => ({
      messages: [...state.messages, { role: 'assistant', content: '' }],
    }))

    streamChat(
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
          case 'done':
            set({ streaming: false, streamingContent: '' })
            get().loadConversations()
            break
          case 'error':
            set({ streaming: false, error: evt.message || '未知错误' })
            break
        }
      },
      (err: Error) => {
        set({ streaming: false, error: err.message })
      },
    )
  },

  clearError: () => set({ error: null }),
}))
