// AI Hubs — 对话页面
// SSE 流式输出 + 对话列表 + 历史回溯 + [AgentName] 前缀

import { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { llmApi } from '../api/chat'
import { Send, Plus, Trash2, Bot, User, Loader2, Settings, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function ChatPage() {
  const navigate = useNavigate()
  const {
    conversations, currentConvId, messages, streaming, error,
    loadConversations, selectConversation, newConversation,
    deleteConversation, sendMessage, clearError,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 加载对话列表 + 检查 LLM 配置
  useEffect(() => {
    loadConversations()
    llmApi.getConfig().then((res) => setLlmConfigured(res.is_configured)).catch(() => {})
  }, [loadConversations])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 发送消息
  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || streaming) return
    sendMessage(text)
    setHistory((h) => [...h, text])
    setInput('')
    setHistoryIdx(-1)
  }, [input, streaming, sendMessage])

  // 键盘事件：Enter 发送，上下箭头回溯
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'ArrowUp' && input === '') {
      e.preventDefault()
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
        setHistoryIdx(newIdx)
        setInput(history[newIdx])
      }
    } else if (e.key === 'ArrowDown' && historyIdx !== -1) {
      e.preventDefault()
      const newIdx = historyIdx + 1
      if (newIdx >= history.length) {
        setHistoryIdx(-1)
        setInput('')
      } else {
        setHistoryIdx(newIdx)
        setInput(history[newIdx])
      }
    }
  }

  return (
    <div className="flex h-full">
      {/* 对话列表 */}
      <div className="w-64 border-r border-border bg-bg-secondary flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-border">
          <button
            onClick={newConversation}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            <Plus size={16} /> 新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-600">暂无对话</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer text-sm transition-colors ${
                  currentConvId === conv.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-neutral-400 hover:bg-bg-tertiary'
                }`}
              >
                <span className="flex-1 truncate">{conv.title || '新对话'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                  className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-opacity"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 主对话区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} className="flex-shrink-0" />
            <span className="flex-1 truncate">{error}</span>
            <button onClick={clearError} className="text-neutral-500 hover:text-neutral-300">×</button>
          </div>
        )}

        {/* LLM 未配置提示 */}
        {llmConfigured === false && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} />
            <span className="flex-1">未配置 LLM API Key，对话功能不可用</span>
            <button onClick={() => navigate('/settings')} className="text-yellow-400 underline">
              去配置
            </button>
          </div>
        )}

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-600">
              <Bot size={48} className="mb-3" />
              <p className="text-sm">开始一个新对话</p>
              <p className="text-xs mt-1">输入消息，按 Enter 发送</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} streaming={streaming && i === messages.length - 1} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行, ↑ 回溯历史)"
              rows={1}
              className="input flex-1 resize-none min-h-[40px] max-h-32"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 128) + 'px'
              }}
              disabled={streaming}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className="btn-primary flex-shrink-0"
            >
              {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 消息气泡 ──

function MessageBubble({ msg, streaming }: { msg: import('../api/chat').ChatMessage; streaming: boolean }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* 头像 */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-accent' : 'bg-bg-tertiary'
      }`}>
        {isUser ? <User size={16} className="text-white" /> : <Bot size={16} className="text-neutral-400" />}
      </div>

      {/* 消息内容 */}
      <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Agent 名称前缀 */}
        {!isUser && msg.agent_name && (
          <span className="text-xs text-accent px-1">[{msg.agent_name}]</span>
        )}
        <div className={`px-4 py-2.5 rounded-lg text-sm leading-relaxed ${
          isUser
            ? 'bg-accent text-white rounded-tr-sm'
            : 'bg-bg-secondary border border-border text-neutral-200 rounded-tl-sm'
        }`}>
          {msg.content || (streaming ? <span className="animate-pulse text-neutral-500">思考中...</span> : '')}
          {streaming && msg.content && <span className="inline-block w-0.5 h-4 bg-accent ml-0.5 animate-pulse" />}
        </div>
      </div>
    </div>
  )
}
