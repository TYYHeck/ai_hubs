// AI Hubs — 专业终端式对话工作台
// 功能：上传文件/拖拽附件([image#N]/[Doc #N]) · 上下箭头回溯 · 左右移动 · 复制粘贴 ·
//       快捷键 · 搜索 · @Agent/#技能 自动补全 · 实时上下文占用 · 发送/暂停

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatStore, CHAT_SHORTCUTS } from '../stores/chatStore'
import { llmApi } from '../api/chat'
import { useNavigate } from 'react-router-dom'
import { TaskDrawer } from '../components/layout/TaskDrawer'
import { agentApi, skillApi, type Agent, type Skill } from '../api/client'
import {
  Send, Plus, Trash2, Bot, User, Loader2, AlertCircle, Paperclip,
  Search, X, Keyboard, Cpu, ListTodo, Sparkles, FileText, Image as ImageIcon,
  ChevronDown, Check, Star, Code, Terminal, Play, CheckCircle, XCircle,
  Settings,
} from 'lucide-react'

// ── 自动补全词条（@Agent / #技能 / /命令）──
interface Completer {
  agents: { name: string }[]
  skills: { name: string }[]
}

export default function ChatPage() {
  const navigate = useNavigate()
  const {
    conversations, currentConvId, messages, streaming, error,
    attachments, uploading, context, selectedSkills, sendQueue,
    loadConversations, selectConversation, newConversation,
    deleteConversation, sendMessage, clearError,
    toggleSkill, clearSkills,
    enqueueMessage, removeQueued, clearQueue, pauseGeneration,
    addAttachments, removeAttachment, refreshContext,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [completers, setCompleters] = useState<Completer>({ agents: [], skills: [] })
  const [completion, setCompletion] = useState<{ items: string[]; active: number; start: number; kind: 'agent' | 'skill' | 'command' } | null>(null)

  // Agent 选择（下拉框 + 输入匹配 + 默认全局默认 Agent）
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentQuery, setAgentQuery] = useState('')
  const [agentOpen, setAgentOpen] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<number | null>(null)

  // 技能选择
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([])
  const [skillSearch, setSkillSearch] = useState('')
  const [skillOpen, setSkillOpen] = useState(false)

  // 模型选择
  const [providers, setProviders] = useState<Record<string, { name: string; base_url: string; models: string[] }>>({})
  const [llmConfig, setLlmConfig] = useState<{ provider: string; model: string; api_key: string; base_url: string }>({ provider: 'deepseek', model: '', api_key: '', base_url: '' })
  const [activeModel, setActiveModel] = useState('')
  const [modelOpen, setModelOpen] = useState(false)

  // 防多重点击
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 全局任务抽屉（由 AppLayout 提供上下文不便，这里自管一个轻量开关）
  const [taskOpen, setTaskOpen] = useState(false)

  useEffect(() => {
    loadConversations()
    llmApi.getConfig().then((res) => setLlmConfigured(res.is_configured)).catch(() => {})
    // 加载 Agent、已安装技能、LLM 配置
    Promise.all([
      agentApi.list().catch(() => []),
      skillApi.list({ installed: true }).catch(() => []),
      llmApi.getProviders().catch(() => ({ providers: {} })),
      llmApi.getConfig().catch(() => ({ config: { provider: 'deepseek', model: '', api_key: '', base_url: '' } })),
    ]).then(([a, s, pRes, cRes]) => {
      const ags: Agent[] = Array.isArray(a) ? a : []
      const sks: Skill[] = Array.isArray(s) ? s : []
      setAgents(ags)
      setInstalledSkills(sks)
      setCompleters({ agents: ags, skills: sks })
      // 默认选中全局默认 Agent
      const def = ags.find(x => x.is_default)
      if (def) setActiveAgentId(def.id)
      // LLM 配置
      setProviders(pRes.providers || {})
      const cfg = cRes.config || { provider: 'deepseek', model: '', api_key: '', base_url: '' }
      setLlmConfig(cfg)
      setActiveModel(cfg.model || '')
    })
  }, [loadConversations])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 发送 / 排队发送
  const doSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    const activeAgent = agents.find(a => a.id === activeAgentId)
    const agentName = activeAgent?.name ?? null

    // 流式生成中：插入到对话队列，本轮结束后自动发送下一条
    if (streaming) {
      enqueueMessage(text, agentName)
    } else {
      if (sending) return
      setSending(true)
      sendMessage(text, agentName, activeModel || null)
      setSending(false)
    }

    setHistory((h) => [...h, text])
    setInput('')
    setHistoryIdx(-1)
    setCompletion(null)
    refreshContext()
  }, [input, streaming, sending, sendMessage, enqueueMessage, refreshContext, agents, activeAgentId, activeModel])

  // 暂停：中断当前 AI 思考（保留对话与已生成内容），而非开启新对话
  const handlePause = () => {
    pauseGeneration()
  }

  // 文本区域按键：Enter 发送 / Shift+Enter 换行 / ↑↓ 回溯 / ←→ 光标移动（默认即可）/ Ctrl 组合
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 自动补全导航
    if (completion) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCompletion({ ...completion, active: (completion.active + 1) % completion.items.length }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCompletion({ ...completion, active: (completion.active - 1 + completion.items.length) % completion.items.length }); return }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applyCompletion(completion.items[completion.active])
        return
      }
      if (e.key === 'Escape') { setCompletion(null); return }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); doSend(); return
    }
    if (e.key === 'ArrowUp' && input === '') {
      e.preventDefault()
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
        setHistoryIdx(newIdx); setInput(history[newIdx])
      }
      return
    }
    if (e.key === 'ArrowDown' && historyIdx !== -1) {
      e.preventDefault()
      const newIdx = historyIdx + 1
      if (newIdx >= history.length) { setHistoryIdx(-1); setInput('') }
      else { setHistoryIdx(newIdx); setInput(history[newIdx]) }
      return
    }
    // Ctrl 组合快捷键
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus() }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 50) }
      else if (e.key.toLowerCase() === 'l') { e.preventDefault(); newConversation() }
    }
  }

  // 输入变化时触发自动补全（@Agent / #技能 / /命令）
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    const caret = e.target.selectionStart ?? val.length
    const before = val.slice(0, caret)

    // 匹配 @Agent 或 #技能 或 /命令
    const m = before.match(/(^|\s)([@#])(\w*)$/)  // @ 和 #
    const mCmd = before.match(/(^|\s)(\/)([\w\u4e00-\u9fff-]*)$/)  // /命令（支持中文）

    if (m) {
      const trigger = m[2]
      const frag = m[3].toLowerCase()
      const pool = trigger === '@' ? completers.agents.map(a => a.name) : completers.skills.map(s => s.name)
      const items = pool.filter(n => n.toLowerCase().includes(frag)).slice(0, 8)
      if (items.length) {
        setCompletion({ items, active: 0, start: caret - frag.length - 1, kind: trigger === '@' ? 'agent' : 'skill' })
        return
      }
    } else if (mCmd) {
      const frag = mCmd[3].toLowerCase()
      const pool = [
        '/ppt', '/幻灯片', '/docx', '/word', '/xlsx', '/excel', '/表格',
        '/pdf', '/search', '/搜索', '/agent', '/智能体', '/create-agent',
        '/task', '/任务', '/theme', '/主题', '/font', '/字体',
        '/skill', '/技能', '/setting', '/设置',
        '/run', '/python', '/js', '/node', '/bash', '/终端', '/code',
      ]
      const items = pool.filter(n => n.toLowerCase().includes(frag)).slice(0, 8)
      if (items.length) {
        setCompletion({ items, active: 0, start: caret - frag.length - 1, kind: 'command' })
        return
      }
    }
    setCompletion(null)
  }

  const applyCompletion = (name: string) => {
    if (!completion) return
    const caret = inputRef.current?.selectionStart ?? input.length
    const newVal = input.slice(0, completion.start) + name + ' ' + input.slice(caret)
    setInput(newVal)
    setCompletion(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // 文件上传 / 拖拽 → 插入占位符
  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    const placeholders: string[] = []
    for (const f of list) {
      try {
        const res = await useChatStore.getState().addAttachments([f])
        if (res?.ok) placeholders.push(res.placeholder)
      } catch { /* ignore */ }
    }
    if (placeholders.length) {
      setInput((prev) => (prev ? prev + ' ' : '') + placeholders.join(' ') + ' ')
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }

  const filteredMessages = useMemo(() => {
    if (!searchTerm) return messages
    return messages.filter(m => (m.content || '').toLowerCase().includes(searchTerm.toLowerCase()))
  }, [messages, searchTerm])

  const contextPct = context ? Math.round(context.usage_ratio * 100) : 0
  const contextColor = contextPct > 80 ? 'bg-red-500' : contextPct > 50 ? 'bg-amber-500' : 'bg-accent'

  return (
    <div className="flex h-full relative">
      {/* 左侧对话列表（折叠式） */}
      <div className="w-60 border-r border-border bg-bg-secondary flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <button onClick={() => { newConversation(); setTaskOpen(false) }}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2">
            <Plus size={16} /> 新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-text-dim">暂无对话</div>
          ) : conversations.map((conv) => (
            <div key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer text-sm transition-colors ${
                currentConvId === conv.id ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-bg-tertiary'}`}>
              <span className="flex-1 truncate">{conv.title || '新对话'}</span>
              <button onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-opacity">
                <Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* 主区 */}
      <div className="flex-1 flex flex-col min-w-0 relative"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}>

        {/* 顶部工具条：选择 Agent / 上传文档 / 管理Agent / 选择技能 / 任务按钮 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-bg-secondary/50 flex-wrap">
          {/* 选择 Agent（下拉框 + 输入匹配） */}
          <div className="relative">
            <button onClick={() => setAgentOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
              <Bot size={14} />
              {activeAgentId ? (agents.find(a => a.id === activeAgentId)?.name ?? '选择 Agent') : '选择 Agent'}
              <ChevronDown size={12} />
            </button>
            {agentOpen && (
              <div className="absolute z-30 mt-1 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <Search size={13} className="text-text-muted" />
                  <input autoFocus value={agentQuery} onChange={e => setAgentQuery(e.target.value)}
                    placeholder="搜索 Agent…"
                    className="flex-1 bg-transparent outline-none text-sm text-text-primary" />
                </div>
                <div className="max-h-56 overflow-auto">
                  {agents.filter(a => a.name.toLowerCase().includes(agentQuery.toLowerCase())).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted">无匹配 Agent</div>
                  ) : agents.filter(a => a.name.toLowerCase().includes(agentQuery.toLowerCase())).map(a => (
                    <div key={a.id} onClick={() => { setActiveAgentId(a.id); setAgentOpen(false); setAgentQuery('') }}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary cursor-pointer">
                      {a.is_default && <Star size={11} className="text-amber-300" />}
                      <span className="flex-1 truncate">{a.name}</span>
                      {activeAgentId === a.id && <Check size={13} className="text-accent" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
            <Paperclip size={14} /> 上传文档
          </button>
          <button onClick={() => navigate('/agents')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
            <Bot size={14} /> 管理 Agent
          </button>

          {/* 选择模型 */}
          <div className="relative">
            <button onClick={() => setModelOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
              <Cpu size={14} />
              {activeModel || llmConfig.model || '选择模型'}
              <ChevronDown size={12} />
            </button>
            {modelOpen && (
              <div className="absolute z-30 mt-1 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-border">
                  <span className="text-[11px] text-text-muted">
                    提供商：{providers[llmConfig.provider]?.name || llmConfig.provider}
                  </span>
                </div>
                <div className="max-h-56 overflow-auto">
                  {(providers[llmConfig.provider]?.models || []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      无可用模型，请先在<button onClick={() => { setModelOpen(false); navigate('/settings') }} className="text-accent hover:underline">设置</button>中配置
                    </div>
                  ) : (providers[llmConfig.provider]?.models || []).map(m => (
                    <div key={m} onClick={() => { setActiveModel(m); setModelOpen(false) }}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary cursor-pointer">
                      <Cpu size={12} className="text-blue-400" />
                      <span className="flex-1 truncate">{m}</span>
                      {activeModel === m && <Check size={13} className="text-accent" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 选择技能（从已安装技能搜索添加） */}
          <div className="relative">
            <button onClick={() => setSkillOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
              <Sparkles size={14} /> 选择技能
              {selectedSkills.length > 0 && (
                <span className="ml-0.5 px-1 rounded-full bg-accent/20 text-accent text-[10px]">{selectedSkills.length}</span>
              )}
            </button>
            {skillOpen && (
              <div className="absolute z-30 mt-1 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <Search size={13} className="text-text-muted" />
                  <input autoFocus value={skillSearch} onChange={e => setSkillSearch(e.target.value)}
                    placeholder="搜索已安装技能…"
                    className="flex-1 bg-transparent outline-none text-sm text-text-primary" />
                </div>
                <div className="max-h-56 overflow-auto">
                  {installedSkills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase())).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted">无匹配技能</div>
                  ) : installedSkills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase())).map(s => (
                    <div key={s.id} onClick={() => toggleSkill(s.name)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary cursor-pointer">
                      <Code size={12} className="text-green-400" />
                      <span className="flex-1 truncate">{s.name}</span>
                      {selectedSkills.includes(s.name) && <Check size={13} className="text-accent" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => setShowShortcuts(s => !s)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-accent transition-colors" title="快捷键">
            <Keyboard size={14} /> 快捷键
          </button>
          <div className="flex-1" />
          <button onClick={() => navigate('/settings')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors" title="LLM 设置">
            <Settings size={14} /> 设置
          </button>
          <button onClick={() => setShowSearch(s => !s)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-accent transition-colors" title="搜索 (Ctrl+F)">
            <Search size={14} /> 搜索
          </button>
          <button onClick={() => setTaskOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors" title="任务流程">
            <ListTodo size={14} /> 任务
          </button>
          <input ref={fileRef} type="file" multiple className="hidden"
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />
        </div>

        {/* 已选技能条 */}
        {selectedSkills.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-bg-tertiary/50 flex-wrap">
            <span className="text-[11px] text-text-muted">本次对话技能：</span>
            {selectedSkills.map(s => (
              <span key={s} className="text-[11px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                <Sparkles size={9} />{s}
                <button onClick={() => toggleSkill(s)} className="hover:text-red-400"><X size={9} /></button>
              </span>
            ))}
            <button onClick={clearSkills} className="text-[11px] text-text-muted hover:text-text-secondary ml-1">清空</button>
          </div>
        )}

        {/* 搜索栏 */}
        {showSearch && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-tertiary">
            <Search size={14} className="text-text-muted" />
            <input ref={searchInputRef} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索对话内容…（Esc 退出）"
              onKeyDown={(e) => e.key === 'Escape' && setShowSearch(false)}
              className="flex-1 bg-transparent outline-none text-sm text-text-primary" />
            <span className="text-xs text-text-dim">{filteredMessages.length} 条</span>
            <button onClick={() => setShowSearch(false)} className="text-text-muted hover:text-text-secondary"><X size={14} /></button>
          </div>
        )}

        {/* 快捷键提示 */}
        {showShortcuts && (
          <div className="px-4 py-2 border-b border-border bg-bg-tertiary grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
            {CHAT_SHORTCUTS.map(s => (
              <div key={s.keys} className="text-[11px] text-text-muted flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-text-muted font-mono">{s.keys}</kbd>
                {s.desc}
              </div>
            ))}
            <button onClick={() => setShowShortcuts(false)} className="text-text-muted hover:text-text-secondary col-span-full text-right"><X size={14} /></button>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} className="flex-shrink-0" />
            <span className="flex-1 truncate">{error}</span>
            <button onClick={clearError} className="text-text-muted hover:text-text-secondary">×</button>
          </div>
        )}

        {/* LLM 未配置 */}
        {llmConfigured === false && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} />
            <span className="flex-1">未配置 LLM API Key，对话功能不可用</span>
            <button onClick={() => navigate('/settings')} className="text-yellow-400 underline">去配置</button>
          </div>
        )}

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-dim">
              <Bot size={48} className="mb-3" />
              <p className="text-sm">开始一个新对话</p>
              <p className="text-xs mt-1">输入消息，按 Enter 发送；拖入图片/文件将自动插入占位符</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {filteredMessages.map((msg, i) => (
                <MessageBubble key={i} msg={msg}
                  msgIndex={messages.indexOf(msg)}
                  highlight={searchTerm}
                  streaming={streaming && i === messages.length - 1 && !searchTerm} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 拖拽遮罩 */}
        {dragOver && (
          <div className="absolute inset-0 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-20 pointer-events-none">
            <div className="text-accent text-sm flex items-center gap-2"><Paperclip size={18} /> 松开以添加附件</div>
          </div>
        )}

        {/* 附件预览条 */}
        {attachments.length > 0 && (
          <div className="px-4 flex flex-wrap gap-2 border-t border-border pt-2">
            {attachments.map(a => (
              <div key={a.id} className="flex items-center gap-1.5 text-xs bg-bg-tertiary border border-border rounded px-2 py-1">
                {a.kind === 'image' ? <ImageIcon size={12} className="text-green-400" />
                  : a.kind === 'doc' ? <FileText size={12} className="text-blue-400" />
                  : <Paperclip size={12} className="text-text-muted" />}
                <span className="text-text-secondary max-w-[140px] truncate">{a.filename}</span>
                <button onClick={() => removeAttachment(a.id)} className="text-text-dim hover:text-red-400"><X size={11} /></button>
              </div>
            ))}
          </div>
        )}

        {/* 自动补全弹层 */}
        {completion && (
          <div className="absolute bottom-24 left-4 right-4 max-w-md mx-auto bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden z-30">
            {completion.items.map((item, i) => (
              <div key={item} onClick={() => applyCompletion(item)}
                className={`px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 ${
                  i === completion.active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-tertiary'}`}>
                {completion.kind === 'agent' ? <Bot size={12} /> : completion.kind === 'skill' ? <Sparkles size={12} /> : <Terminal size={12} />}
                {item}
              </div>
            ))}
          </div>
        )}

        {/* 底部输入 + 状态栏 */}
        <div className="border-t border-border p-3 bg-bg-secondary/50">
          <div className="max-w-3xl mx-auto">
            {/* 对话队列：流式期间排队，本轮结束后自动发送下一条 */}
            {sendQueue.length > 0 && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[11px] text-text-muted">待发送队列 {sendQueue.length}</span>
                {sendQueue.map((q, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-bg-tertiary border border-border text-text-secondary flex items-center gap-1 max-w-[220px]">
                    <ListTodo size={10} className="text-accent flex-shrink-0" />
                    <span className="truncate">{q.text}</span>
                    <button onClick={() => removeQueued(i)} className="hover:text-red-400"><X size={9} /></button>
                  </span>
                ))}
                <button onClick={clearQueue} className="text-[11px] text-text-muted hover:text-text-secondary">清空</button>
              </div>
            )}

            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={streaming ? "AI 生成中…输入后点「排队发送」可插入下一条" : "输入消息… @Agent #技能 /命令 自动补全 · Enter 发送 · ↑ 回溯历史 · 拖入文件插入占位符"}
                rows={1}
                className="input flex-1 resize-none min-h-[40px] max-h-32"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 128) + 'px'
                }}
              />
              {streaming ? (
                <>
                  <button onClick={doSend}
                    className="btn-secondary flex-shrink-0 flex items-center gap-1.5"
                    disabled={!input.trim()}>
                    <ListTodo size={16} /> 排队发送
                  </button>
                  <button onClick={handlePause}
                    className="btn-danger flex-shrink-0 flex items-center gap-1.5"><PauseIco /> 暂停</button>
                </>
              ) : (
                <button onClick={doSend} disabled={!input.trim() || uploading || sending}
                  className="btn-primary flex-shrink-0 flex items-center gap-1.5">
                  {uploading || sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} 发送
                </button>
              )}
            </div>

            {/* 状态栏 */}
            <div className="flex items-center gap-4 mt-2 text-[11px] text-text-muted">
              <span className="flex items-center gap-1.5"><Cpu size={12} />
                模型 {context?.model || activeModel || llmConfig.model || '—'}</span>
              <span className="flex items-center gap-1.5 flex-1 max-w-[260px]">
                长上下文
                <span className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                  <span className={`h-full rounded-full ${contextColor}`}
                    style={{ width: `${Math.min(100, contextPct)}%` }} />
                </span>
                {context ? `${contextPct}% (${(context.used_tokens / 1000).toFixed(1)}k/${context.context_window / 1000}k)` : ''}
              </span>
              <span className="text-text-dim">{messages.length} 条消息</span>
              <span className="text-text-dim">Ctrl+K 聚焦 · Ctrl+F 搜索 · Ctrl+L 清屏</span>
            </div>
          </div>
        </div>
      </div>

      {/* 全局任务侧边栏 */}
      {taskOpen && (
        <TaskDrawer open onClose={() => setTaskOpen(false)} />
      )}
    </div>
  )
}

// ── 交互式组件（request_user_input 工具产出的前端渲染）──
function InteractiveWidget({ interactive, onRespond }: {
  interactive: NonNullable<import('../api/chat').ChatMessage['interactive']>
  onRespond: (response: string) => void
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])

  const { interaction_type, title, message, options, fields, confirm_text, cancel_text } = interactive

  if (interaction_type === 'confirm') {
    return (
      <div className="max-w-[85%] px-4 py-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
        <div className="font-medium text-text-primary mb-1">{title}</div>
        <div className="text-text-muted text-xs mb-3">{message}</div>
        <div className="flex gap-2">
          <button onClick={() => onRespond('确认')}
            className="px-4 py-1.5 rounded text-xs font-medium bg-accent text-white hover:bg-accent/80 transition-colors">
            {confirm_text}
          </button>
          <button onClick={() => onRespond('取消')}
            className="px-4 py-1.5 rounded text-xs font-medium border border-border text-text-muted hover:text-text-primary hover:border-neutral-500 transition-colors">
            {cancel_text}
          </button>
        </div>
      </div>
    )
  }

  if (interaction_type === 'select' && options) {
    return (
      <div className="max-w-[85%] px-4 py-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
        <div className="font-medium text-text-primary mb-1">{title}</div>
        <div className="text-text-muted text-xs mb-3">{message}</div>
        <div className="flex flex-col gap-1.5 mb-3">
          {options.map((opt) => (
            <button key={opt.value} onClick={() => onRespond(opt.value)}
              className="text-left px-3 py-2 rounded text-xs border border-border text-text-secondary hover:border-accent/50 hover:text-accent hover:bg-accent/5 transition-colors">
              <span className="font-medium">{opt.label}</span>
              {opt.description && <span className="text-text-muted ml-2">{opt.description}</span>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (interaction_type === 'multi_select' && options) {
    const toggleOption = (value: string) => {
      setSelectedOptions(prev =>
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
      )
    }
    return (
      <div className="max-w-[85%] px-4 py-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
        <div className="font-medium text-text-primary mb-1">{title}</div>
        <div className="text-text-muted text-xs mb-3">{message}</div>
        <div className="flex flex-col gap-1.5 mb-3">
          {options.map((opt) => (
            <label key={opt.value}
              className={`flex items-center gap-2 px-3 py-2 rounded text-xs border cursor-pointer transition-colors ${
                selectedOptions.includes(opt.value)
                  ? 'border-accent/50 text-accent bg-accent/5'
                  : 'border-border text-text-muted hover:border-neutral-500'
              }`}>
              <input type="checkbox" checked={selectedOptions.includes(opt.value)}
                onChange={() => toggleOption(opt.value)} className="sr-only" />
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                selectedOptions.includes(opt.value) ? 'bg-accent border-accent' : 'border-neutral-600'
              }`}>
                {selectedOptions.includes(opt.value) && <Check size={10} className="text-white" />}
              </div>
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        <button onClick={() => onRespond(selectedOptions.join(', '))}
          disabled={selectedOptions.length === 0}
          className="px-4 py-1.5 rounded text-xs font-medium bg-accent text-white hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          确认选择 ({selectedOptions.length})
        </button>
      </div>
    )
  }

  if (interaction_type === 'form' && fields) {
    const handleSubmit = () => {
      const parts = fields.map(f => `${f.label}: ${formValues[f.name] || '(未填)'}`)
      onRespond(parts.join('；'))
    }
    return (
      <div className="max-w-[85%] px-4 py-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
        <div className="font-medium text-text-primary mb-1">{title}</div>
        <div className="text-text-muted text-xs mb-3">{message}</div>
        <div className="flex flex-col gap-2 mb-3">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="block text-xs text-text-muted mb-1">{field.label}{field.required ? ' *' : ''}</label>
              {field.type === 'textarea' ? (
                <textarea value={formValues[field.name] || ''}
                  onChange={e => setFormValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 resize-none" />
              ) : field.type === 'select' && field.options ? (
                <select value={formValues[field.name] || field.default || ''}
                  onChange={e => setFormValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50">
                  <option value="">请选择…</option>
                  {field.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input type={field.type === 'password' ? 'password' : 'text'}
                  value={formValues[field.name] || field.default || ''}
                  onChange={e => setFormValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50" />
              )}
            </div>
          ))}
        </div>
        <button onClick={handleSubmit}
          className="px-4 py-1.5 rounded text-xs font-medium bg-accent text-white hover:bg-accent/80 transition-colors">
          提交
        </button>
      </div>
    )
  }

  // 未知类型
  return (
    <div className="max-w-[85%] px-4 py-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
      <div className="font-medium text-text-primary">{title}</div>
      <div className="text-text-muted text-xs">{message}</div>
    </div>
  )
}

// ── 处理交互式组件响应 ──
function handleInteractiveResponse(msgIndex: number, response: string) {
  const store = useChatStore.getState()
  const msgs = [...store.messages]
  const msg = msgs[msgIndex]
  if (msg && msg.interactive) {
    msgs[msgIndex] = { ...msg, interactive_answered: true, content: response }
    store.setState({ messages: msgs })
    // 将用户响应作为后续消息发送回对话
    store.sendMessage(response, undefined, undefined)
  }
}

// ── 消息气泡（支持 agent 前缀 + 搜索高亮 + 占位符渲染 + 工具消息 + 交互提问）──
function MessageBubble({ msg, highlight, streaming, msgIndex }: {
  msg: import('../api/chat').ChatMessage; highlight?: string; streaming: boolean; msgIndex?: number
}) {
  const isUser = msg.role === 'user'
  const isTool = msg.role === 'tool'
  const submitAskAnswer = useChatStore((s) => s.submitAskAnswer)

  // 工具消息：独立的紧凑渲染
  if (isTool) {
    // 交互式组件特殊渲染
    if (msg.interactive && !msg.interactive_answered) {
      return (
        <div className="flex gap-2 items-start">
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-accent/20 border border-accent/40 mt-0.5">
            <Sparkles size={12} className="text-accent" />
          </div>
          <InteractiveWidget
            interactive={msg.interactive}
            onRespond={(response) => {
              if (msgIndex != null) handleInteractiveResponse(msgIndex, response)
            }}
          />
        </div>
      )
    }

    return (
      <div className="flex gap-2 items-start">
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-purple-500/20 border border-purple-500/40 mt-0.5">
          <Terminal size={12} className="text-purple-400" />
        </div>
        <div className="flex flex-col gap-1 max-w-[85%]">
          <div className="px-3 py-2 rounded-lg text-xs bg-purple-500/5 border border-purple-500/20 text-text-secondary">
            <div className="flex items-center gap-1.5 text-text-muted mb-1">
              {msg.tool_pending ? (
                <Loader2 size={11} className="animate-spin text-purple-400" />
              ) : (
                <CheckCircle size={11} className="text-green-400" />
              )}
              <span className="font-medium">{msg.tool_summary || `执行 ${msg.tool_name || '工具'}`}</span>
            </div>
            {msg.tool_pending ? (
              <span className="text-text-muted italic">执行中…</span>
            ) : msg.tool_result ? (
              <pre className="mt-1 text-[11px] text-text-muted bg-black/20 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                {msg.tool_result}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
        isUser ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary'}`}>
        {isUser ? <User size={16} className="text-white" /> : (msg.agent_name || 'AI').slice(0, 1).toUpperCase()}
      </div>
      <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {!isUser && msg.agent_name && (
          <span className="text-xs text-accent px-1">{msg.agent_name}</span>
        )}
        <div className={`px-4 py-2.5 rounded-lg text-sm leading-relaxed ${
          isUser ? 'bg-accent text-white rounded-tr-sm'
                 : 'bg-bg-secondary border border-border text-text-primary rounded-tl-sm'}`}>
          {msg.content ? <ContentWithRefs text={msg.content} highlight={highlight} isUser={isUser} /> :
            (streaming ? <span className="animate-pulse text-text-muted">思考中...</span> : '')}
          {streaming && msg.content && <span className="inline-block w-0.5 h-4 bg-accent ml-0.5 animate-pulse" />}
        </div>
        {/* 交互式提问表单 */}
        {!isUser && msg.ask_data && msg.ask_data.length > 0 && !msg.ask_answered && msgIndex != null && (
          <AskForm questions={msg.ask_data} onSubmit={(answers) => submitAskAnswer(msgIndex, answers)} />
        )}
      </div>
    </div>
  )
}

// 渲染 [image#N] / [Doc #N] 占位符为可点击标签，AI 消息启用 Markdown 渲染
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function ContentWithRefs({ text, highlight, isUser }: { text: string; highlight?: string; isUser?: boolean }) {
  const parts = text.split(/(\[(?:image|doc|Doc|file)#\d+\])/g)
  return (
    <>
      {parts.map((p, i) => {
        if (/^\[(?:image|doc|Doc|file)#\d+\]$/.test(p)) {
          const kind = p.startsWith('[image') || p.startsWith('[Image') ? 'image' : p.startsWith('[doc') || p.startsWith('[Doc') ? 'doc' : 'file'
          const Icon = kind === 'image' ? ImageIcon : kind === 'doc' ? FileText : Paperclip
          const color = kind === 'image' ? 'text-green-400 border-green-500/40'
            : kind === 'doc' ? 'text-blue-400 border-blue-500/40' : 'text-text-muted border-border'
          return (
            <span key={i} className={`inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded border text-[11px] ${color} bg-black/20 align-middle`}>
              <Icon size={10} />{p}
            </span>
          )
        }
        // 用户消息保持纯文本，AI 消息启用 Markdown 渲染
        if (!isUser && p.trim()) {
          return (
            <div key={i} className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {p}
              </ReactMarkdown>
            </div>
          )
        }
        // 用户消息纯文本 + 搜索高亮
        if (highlight && p.toLowerCase().includes(highlight.toLowerCase())) {
          const idx = p.toLowerCase().indexOf(highlight.toLowerCase())
          return <span key={i}>{p.slice(0, idx)}<mark className="bg-yellow-400/30 text-yellow-200 rounded">{highlight}</mark>{p.slice(idx + highlight.length)}</span>
        }
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

// ── 交互式提问表单组件 ──
import type { AskQuestion } from '../api/chat'

function AskForm({ questions, onSubmit }: {
  questions: AskQuestion[]; onSubmit: (answers: Record<string, string>) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const q of questions) {
      if (q.default) initial[q.id] = q.default
    }
    return initial
  })
  const [multiselectVals, setMultiselectVals] = useState<Record<string, Set<string>>>({})

  const handleSubmit = () => {
    // 将 multiselect values 合并到 answers 中
    const final: Record<string, string> = { ...answers }
    for (const [id, vals] of Object.entries(multiselectVals)) {
      if (vals.size > 0) final[id] = [...vals].join('、')
    }
    onSubmit(final)
  }

  const toggleMulti = (qId: string, opt: string) => {
    setMultiselectVals((prev) => {
      const cur = new Set(prev[qId] || [])
      if (cur.has(opt)) cur.delete(opt)
      else cur.add(opt)
      return { ...prev, [qId]: cur }
    })
  }

  const canSubmit = questions.every((q) => {
    if (q.type === 'confirm') return true
    const msVals = multiselectVals[q.id]
    if (q.type === 'multiselect') return msVals && msVals.size > 0
    return !!answers[q.id]
  })

  return (
    <div className="mt-2 w-full max-w-[440px] bg-bg-tertiary border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
        <Sparkles size={12} className="text-amber-400" />
        请选择或填写以下问题
      </div>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <label className="text-xs font-medium text-text-primary block">{q.title}</label>
          {q.type === 'text' && (
            <input
              type="text"
              className="input text-sm w-full"
              placeholder={q.placeholder}
              value={answers[q.id] || ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
            />
          )}
          {(q.type === 'choice' || q.type === 'multiselect') && (q.options || []).map((opt) => (
            <button
              key={opt}
              onClick={() => {
                if (q.type === 'multiselect') {
                  toggleMulti(q.id, opt)
                } else {
                  setAnswers((a) => ({ ...a, [q.id]: opt }))
                }
              }}
              className={`w-full text-left text-sm px-3 py-2 rounded border transition-colors ${
                q.type === 'multiselect'
                  ? (multiselectVals[q.id]?.has(opt)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:border-accent/40 hover:text-text-primary')
                  : (answers[q.id] === opt
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:border-accent/40 hover:text-text-primary')
              }`}
            >
              {q.type === 'multiselect' && (
                <span className="mr-2">{multiselectVals[q.id]?.has(opt) ? '☑' : '☐'}</span>
              )}
              {opt}
            </button>
          ))}
          {q.type === 'confirm' && (
            <div className="flex gap-2">
              <button
                onClick={() => { setAnswers((a) => ({ ...a, [q.id]: 'yes' })); }}
                className={`flex-1 text-sm px-4 py-2 rounded border transition-colors ${
                  answers[q.id] === 'yes'
                    ? 'border-green-500 bg-green-500/10 text-green-400'
                    : 'border-border text-text-muted hover:border-green-500/40 hover:text-green-300'
                }`}
              >
                {q.yes || '确认'}
              </button>
              <button
                onClick={() => { setAnswers((a) => ({ ...a, [q.id]: 'no' })); }}
                className={`flex-1 text-sm px-4 py-2 rounded border transition-colors ${
                  answers[q.id] === 'no'
                    ? 'border-red-500 bg-red-500/10 text-red-400'
                    : 'border-border text-text-muted hover:border-red-500/40 hover:text-red-300'
                }`}
              >
                {q.no || '取消'}
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
          canSubmit
            ? 'bg-accent text-white hover:bg-accent/90'
            : 'bg-bg-secondary text-text-dim cursor-not-allowed'
        }`}
      >
        提交回答
      </button>
    </div>
  )
}

// 暂停图标（避免与 Pause 冲突引入）
function PauseIco() { return <span className="text-[13px]">⏸</span> }
