import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Plus, Folder, RefreshCw, Upload, Download, Eye, Trash2,
  FileCode, FolderOpen, ChevronRight, ChevronDown,
  Play, Terminal, Code2, X, GripVertical,
  ZoomIn, ZoomOut, Maximize2, Menu,
  User, Bot, Loader2, FileText, Paperclip, Send,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Cpu, Sparkles, Search, Trash2 as TrashIcon, Star, Check,
  Keyboard, Settings, ListTodo, AlertCircle, Image as ImageIcon,
  Pause as PauseIco,
} from 'lucide-react'
import { ideApi, type FsNode, type RunResult, agentApi, skillApi, type Agent, type Skill } from '../api/client'
import { llmApi } from '../api/chat'
import { useChatStore, CHAT_SHORTCUTS, onAIMutation, onUIAction } from '../stores/chatStore'
import { FilePreviewModal } from '../components/FilePreviewModal'
import { TaskDrawer } from '../components/layout/TaskDrawer'

interface Completer {
  agents: { name: string }[]
  skills: { name: string }[]
}

function langOf(path: string) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'py': return python()
    case 'js': case 'mjs': case 'jsx': case 'ts': case 'tsx': return javascript({ jsx: true })
    case 'json': return json()
    case 'html': case 'htm': return html()
    case 'css': return css()
    case 'md': return markdown()
    case 'c': case 'h': return cpp()
    case 'cpp': case 'cc': case 'hpp': return cpp()
    case 'java': return java()
    default: return []
  }
}

const textExts = ['py', 'js', 'mjs', 'jsx', 'ts', 'tsx', 'json', 'html', 'htm', 'css', 'md', 'txt', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'java', 'go', 'rs', 'php', 'sql', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log']

function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return textExts.includes(ext)
}

interface TreeNodeProps {
  node: FsNode; depth: number
  onOpen: (n: FsNode) => void
  activePath: string; onDelete: (n: FsNode) => void; onPreview: (n: FsNode) => void; onDownload: (path: string, name: string) => void
}

function TreeNode({ node, depth, onOpen, activePath, onDelete, onPreview, onDownload }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2)
  const pad = { paddingLeft: `${depth * 12 + 6}px` }
  if (node.type === 'dir') {
    return (
      <div>
        <div className="flex items-center gap-1 py-0.5 pr-2 hover:bg-bg-tertiary rounded cursor-pointer group" style={pad}>
          <button onClick={() => setOpen(v => !v)} className="text-text-muted">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {open ? <FolderOpen size={12} className="text-accent/80" /> : <Folder size={12} className="text-accent/80" />}
          <span className="text-xs text-text-secondary flex-1 truncate">{node.name || 'workspace'}</span>
        </div>
        {open && node.children?.map(c => (
          <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} activePath={activePath} onDelete={onDelete} onPreview={onPreview} onDownload={onDownload} />
        ))}
      </div>
    )
  }
  return (
    <div
      className={`flex items-center gap-1 py-0.5 pr-2 rounded cursor-pointer group ${activePath === node.path ? 'bg-accent/10 text-accent' : 'hover:bg-bg-tertiary text-text-secondary'}`}
      style={pad}
      onClick={() => onOpen(node)}
    >
      <span className="w-[12px]" />
      <FileCode size={12} className="text-text-muted flex-shrink-0" />
      <span className="text-xs flex-1 truncate">{node.name}</span>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        <button onClick={e => { e.stopPropagation(); onPreview(node) }} className="p-0.5 text-text-muted hover:text-accent"><Eye size={10} /></button>
        <button onClick={e => { e.stopPropagation(); onDownload(node.path, node.name) }} className="p-0.5 text-text-muted hover:text-accent"><Download size={10} /></button>
        <button onClick={e => { e.stopPropagation(); onDelete(node) }} className="p-0.5 text-text-muted hover:text-red-500 dark:hover:text-red-400"><Trash2 size={10} /></button>
      </div>
    </div>
  )
}

function ChatSidebar() {
  const { conversations, currentConvId, selectConversation, newConversation, deleteConversation, loadConversations } = useChatStore()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => { loadConversations() }, [])

  return (
    <div className="w-44 flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-[10px] text-text-muted">对话</span>
        <button onClick={() => newConversation()} className="p-0.5 text-text-muted hover:text-accent" title="新对话">
          <Plus size={10} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-0.5">
        {conversations.map(c => (
          <div key={c.id}
            className={`px-2 py-1 text-[11px] cursor-pointer transition-colors ${
              currentConvId === c.id ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
            onClick={() => selectConversation(c.id)}
            onMouseEnter={() => setHoveredId(c.id)}
            onMouseLeave={() => setHoveredId(null)}>
            <div className="flex items-center justify-between">
              <span className="truncate flex-1">{c.title}</span>
              {hoveredId === c.id && (
                <button onClick={e => { e.stopPropagation(); deleteConversation(c.id) }} className="text-text-dim hover:text-red-500">
                  <X size={9} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatPanel() {
  const navigate = useNavigate()
  const {
    conversations, currentConvId, messages, streaming, error,
    attachments, uploading, context, selectedSkills, sendQueue,
    loadConversations, selectConversation, newConversation,
    deleteConversation, sendMessage, clearError, clearMessages,
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
  const [completionPos, setCompletionPos] = useState<{ left: number; bottom: number } | null>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  const [agents, setAgents] = useState<Agent[]>([])
  const [agentQuery, setAgentQuery] = useState('')
  const [agentOpen, setAgentOpen] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<number | null>(null)

  const [installedSkills, setInstalledSkills] = useState<Skill[]>([])
  const [skillSearch, setSkillSearch] = useState('')
  const [skillOpen, setSkillOpen] = useState(false)

  const [providers, setProviders] = useState<Record<string, { name: string; base_url: string; models: string[] }>>({})
  const [llmConfig, setLlmConfig] = useState<{ provider: string; model: string; api_key: string; base_url: string }>({ provider: 'deepseek', model: '', api_key: '', base_url: '' })
  const [activeModel, setActiveModel] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const [showThink, setShowThink] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadConversations()
    llmApi.getConfig().then((res) => setLlmConfigured(res.is_configured)).catch(() => {})
    Promise.all([
      agentApi.list().catch(() => []),
      skillApi.list({ installed: true } as any).catch(() => []),
      llmApi.getProviders().catch(() => ({ providers: {} })),
      llmApi.getConfig().catch(() => ({ config: { provider: 'deepseek', model: '', api_key: '', base_url: '' } })),
    ]).then(([a, s, pRes, cRes]) => {
      const ags: Agent[] = Array.isArray(a) ? a : []
      const sks: Skill[] = Array.isArray(s) ? s : []
      setAgents(ags)
      setInstalledSkills(sks)
      setCompleters({ agents: ags, skills: sks })
      const def = ags.find(x => x.is_default)
      if (def) setActiveAgentId(def.id)
      setProviders(pRes.providers || {})
      setLlmConfig(cRes.config || cRes || { provider: 'deepseek', model: '', api_key: '', base_url: '' })
      if (cRes.config?.model) setActiveModel(cRes.config.model)
    })
  }, [])

  useEffect(() => { refreshContext() }, [currentConvId, messages.length])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (completion) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCompletion({ ...completion, active: (completion.active + 1) % completion.items.length }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCompletion({ ...completion, active: (completion.active - 1 + completion.items.length) % completion.items.length }); return }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applyCompletion(completion.items[completion.active])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setCompletion(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
      return
    }
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const t = e.target as HTMLTextAreaElement
      if (t.selectionStart === 0 && history.length > 0) {
        e.preventDefault()
        const idx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx
        setHistoryIdx(idx)
        setInput(history[history.length - 1 - idx] || '')
      }
    }
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const t = e.target as HTMLTextAreaElement
      if (t.selectionStart === input.length && historyIdx >= 0) {
        e.preventDefault()
        const idx = historyIdx - 1
        setHistoryIdx(idx)
        setInput(idx >= 0 ? history[history.length - 1 - idx] : '')
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    const caret = e.target.selectionStart ?? val.length
    const before = val.slice(0, caret)

    // 计算光标位置
    const calcCaretPos = () => {
      if (!inputRef.current || !mirrorRef.current) return null
      const ta = inputRef.current
      const mirror = mirrorRef.current
      const style = window.getComputedStyle(ta)
      const props = ['boxSizing','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontSizeAdjust','lineHeight','fontFamily','textAlign','textTransform','textIndent','textDecoration','letterSpacing','wordSpacing','tabSize','whiteSpace','wordBreak','overflowWrap']
      props.forEach(p => {
        // @ts-ignore
        mirror.style[p] = style[p]
      })
      mirror.style.position = 'absolute'
      mirror.style.visibility = 'hidden'
      mirror.style.top = '0'
      mirror.style.left = '-9999px'
      mirror.style.width = style.width
      mirror.style.height = 'auto'
      mirror.textContent = before + '\u200b'
      const rect = mirror.getBoundingClientRect()
      const taRect = ta.getBoundingClientRect()
      return {
        left: rect.left - taRect.left,
        bottom: taRect.height - (rect.top - taRect.top + rect.height),
      }
    }

    const m = before.match(/(^|\s)([@#])(\w*)$/)
    const mCmd = before.match(/(^|\s)(\/)([\w\u4e00-\u9fff-]*)$/)
    if (m) {
      const trigger = m[2]
      const frag = m[3].toLowerCase()
      const pool = trigger === '@' ? completers.agents.map(a => a.name) : completers.skills.map(s => s.name)
      const items = pool.filter(n => n.toLowerCase().includes(frag)).slice(0, 8)
      if (items.length) {
        setCompletion({ items, active: 0, start: caret - frag.length - 1, kind: trigger === '@' ? 'agent' : 'skill' })
        setCompletionPos(calcCaretPos())
        return
      }
    } else if (mCmd) {
      const frag = mCmd[3].toLowerCase()
      const pool = [
        '/clear', '/new', '/help', '/ppt', '/docx', '/xlsx', '/pdf',
        '/run', '/python', '/js', '/bash', '/code',
        '/agent', '/skill', '/setting', '/ide', '/tasks',
      ]
      const items = pool.filter(n => n.toLowerCase().includes(frag)).slice(0, 8)
      if (items.length) {
        setCompletion({ items, active: 0, start: caret - frag.length - 1, kind: 'command' })
        setCompletionPos(calcCaretPos())
        return
      }
    }
    setCompletion(null)
    setCompletionPos(null)
  }

  const applyCompletion = (name: string) => {
    if (!completion) return
    const caret = inputRef.current?.selectionStart ?? input.length
    const newVal = input.slice(0, completion.start) + name + ' ' + input.slice(caret)
    setInput(newVal)
    setCompletion(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    const placeholders: string[] = []
    for (const f of list) {
      try {
        const res: any = await useChatStore.getState().addAttachments([f])
        if (res?.ok || res?.placeholder) placeholders.push(res.placeholder)
      } catch { /* ignore */ }
    }
    if (placeholders.length) {
      setInput((prev) => (prev ? prev + ' ' : '') + placeholders.join(' ') + ' ')
    }
  }

  const filteredMessages = useMemo(() => {
    if (!searchTerm) return messages
    return messages.filter(m => (m.content || '').toLowerCase().includes(searchTerm.toLowerCase()))
  }, [messages, searchTerm])

  const contextPct = context ? Math.round(context.usage_ratio * 100) : 0
  const contextColor = contextPct > 80 ? 'bg-red-500' : contextPct > 50 ? 'bg-amber-500' : 'bg-accent'

  const doSend = async () => {
    if (!input.trim() && attachments.length === 0) return
    if (streaming) {
      enqueueMessage(input)
      setInput('')
      setHistory(h => [...h, input])
      setHistoryIdx(-1)
      return
    }
    setSending(true)
    const activeAgent = agents.find(a => a.id === activeAgentId)
    try {
      setHistory(h => [...h, input])
      setHistoryIdx(-1)
      await sendMessage(input, activeAgent?.name || null, activeModel || null)
      setInput('')
    } finally {
      setSending(false)
    }
  }

  const handlePause = () => { pauseGeneration() }

  return (
    <div className={`flex flex-col h-full bg-bg-secondary ${dragOver ? 'ring-2 ring-accent/30' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }}>

      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-bg-tertiary gap-1">
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          <button onClick={() => setShowSidebar(!showSidebar)} className="p-1 text-text-muted hover:text-text-primary flex-shrink-0" title="对话列表">
            <Menu size={11} />
          </button>

          <div className="relative flex-shrink-0">
            <button onClick={() => setAgentOpen(o => !o)}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
              <Bot size={10} />
              <span className="max-w-[50px] truncate hidden sm:inline">
                {activeAgentId ? agents.find(a => a.id === activeAgentId)?.name || 'Agent' : 'Agent'}
              </span>
            </button>
            {agentOpen && (
              <div className="absolute z-30 mt-1 w-52 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden left-0">
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
                  <Search size={10} className="text-text-muted" />
                  <input autoFocus value={agentQuery} onChange={e => setAgentQuery(e.target.value)}
                    placeholder="搜索 Agent…"
                    className="flex-1 bg-transparent outline-none text-[11px] text-text-primary" />
                </div>
                <div className="max-h-44 overflow-auto">
                  {agents.filter(a => a.name.toLowerCase().includes(agentQuery.toLowerCase())).length === 0 ? (
                    <div className="px-2 py-1.5 text-[10px] text-text-muted">无匹配 Agent</div>
                  ) : agents.filter(a => a.name.toLowerCase().includes(agentQuery.toLowerCase())).map(a => (
                    <div key={a.id} onClick={() => { setActiveAgentId(a.id); setAgentOpen(false); setAgentQuery('') }}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-primary hover:bg-bg-tertiary cursor-pointer">
                      {a.is_default && <Star size={9} className="text-amber-500" />}
                      <span className="flex-1 truncate">{a.name}</span>
                      {activeAgentId === a.id && <Check size={10} className="text-accent" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative flex-shrink-0">
            <button onClick={() => setModelOpen(o => !o)}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
              <Cpu size={10} />
              <span className="max-w-[40px] truncate hidden sm:inline">
                {activeModel || llmConfig.model || '模型'}
              </span>
            </button>
            {modelOpen && (
              <div className="absolute z-30 mt-1 w-52 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden left-0">
                <div className="px-2 py-1.5 border-b border-border">
                  <span className="text-[9px] text-text-muted">{providers[llmConfig.provider]?.name || llmConfig.provider}</span>
                </div>
                <div className="max-h-44 overflow-auto">
                  {(providers[llmConfig.provider]?.models || []).length === 0 ? (
                    <div className="px-2 py-1.5 text-[10px] text-text-muted">无可用模型</div>
                  ) : (providers[llmConfig.provider]?.models || []).map(m => (
                    <div key={m} onClick={() => { setActiveModel(m); setModelOpen(false) }}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-primary hover:bg-bg-tertiary cursor-pointer">
                      <Cpu size={9} className="text-blue-500" />
                      <span className="flex-1 truncate">{m}</span>
                      {activeModel === m && <Check size={10} className="text-accent" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative flex-shrink-0">
            <button onClick={() => setSkillOpen(o => !o)}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
              <Sparkles size={10} />
              {selectedSkills.length > 0 && (
                <span className="px-0.5 rounded-full bg-accent/20 text-accent text-[8px]">{selectedSkills.length}</span>
              )}
            </button>
            {skillOpen && (
              <div className="absolute z-30 mt-1 w-52 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden left-0">
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
                  <Search size={10} className="text-text-muted" />
                  <input autoFocus value={skillSearch} onChange={e => setSkillSearch(e.target.value)}
                    placeholder="搜索技能…"
                    className="flex-1 bg-transparent outline-none text-[11px] text-text-primary" />
                </div>
                <div className="max-h-44 overflow-auto">
                  {installedSkills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase())).length === 0 ? (
                    <div className="px-2 py-1.5 text-[10px] text-text-muted">无匹配技能</div>
                  ) : installedSkills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase())).map(s => (
                    <div key={s.id} onClick={() => toggleSkill(s.name)}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-primary hover:bg-bg-tertiary cursor-pointer">
                      <Code2 size={9} className="text-green-500" />
                      <span className="flex-1 truncate">{s.name}</span>
                      {selectedSkills.includes(s.name) && <Check size={10} className="text-accent" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => { setShowSearch(!showSearch); setSearchTerm('') }}
            className={`p-1 ${showSearch ? 'text-accent' : 'text-text-muted'} hover:text-text-primary`} title="搜索 (Ctrl+F)">
            <Search size={10} />
          </button>
          <button onClick={() => setShowThink(!showThink)}
            className={`p-1 ${showThink ? 'text-purple-500' : 'text-text-muted'} hover:text-text-primary`}
            title={showThink ? '隐藏思考' : '显示思考'}>
            <Sparkles size={10} />
          </button>
          <button onClick={() => setTaskOpen(true)}
            className="p-1 text-text-muted hover:text-accent" title="任务流程">
            <ListTodo size={10} />
          </button>
          <button onClick={() => { if (confirm('确定清空当前对话？')) clearMessages() }}
            className="p-1 text-text-muted hover:text-red-500 hidden sm:block" title="清空对话">
            <TrashIcon size={10} />
          </button>
          {streaming && (
            <button onClick={handlePause} className="p-1 text-text-muted hover:text-red-500" title="暂停">
              <PauseIco size={10} />
            </button>
          )}
        </div>
      </div>

      {/* 已选技能条 */}
      {selectedSkills.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-0.5 border-b border-border bg-bg-tertiary/50 flex-wrap">
          <span className="text-[9px] text-text-muted">技能：</span>
          {selectedSkills.map(s => (
            <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 flex items-center gap-0.5">
              <Sparkles size={8} />{s}
              <button onClick={() => toggleSkill(s)} className="hover:text-red-500"><X size={8} /></button>
            </span>
          ))}
          <button onClick={clearSkills} className="text-[9px] text-text-muted hover:text-text-secondary ml-0.5">清空</button>
        </div>
      )}

      {/* 搜索栏 */}
      {showSearch && (
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-tertiary">
          <Search size={10} className="text-text-muted" />
          <input ref={searchInputRef} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索…"
            onKeyDown={(e) => e.key === 'Escape' && setShowSearch(false)}
            className="flex-1 bg-transparent outline-none text-[11px] text-text-primary" />
          <span className="text-[9px] text-text-dim">{filteredMessages.length}</span>
          <button onClick={() => setShowSearch(false)} className="text-text-muted hover:text-text-secondary"><X size={10} /></button>
        </div>
      )}

      {/* 快捷键 */}
      {showShortcuts && (
        <div className="px-2 py-1 border-b border-border bg-bg-tertiary grid grid-cols-2 gap-x-3 gap-y-0.5">
          {CHAT_SHORTCUTS.map(s => (
            <div key={s.keys} className="text-[9px] text-text-muted flex items-center gap-1">
              <kbd className="px-1 py-px rounded bg-bg-secondary border border-border text-text-dim font-mono text-[8px]">{s.keys}</kbd>
              {s.desc}
            </div>
          ))}
          <button onClick={() => setShowShortcuts(false)} className="text-text-muted hover:text-text-secondary col-span-full text-right"><X size={10} /></button>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="mx-2 mt-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] flex items-center gap-1">
          <AlertCircle size={10} className="flex-shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={clearError} className="text-text-muted hover:text-text-secondary">×</button>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex min-h-0">
        {showSidebar && <ChatSidebar />}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-2 py-1.5">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-dim">
                <Bot size={24} className="mb-1 opacity-40" />
                <p className="text-[11px]">开始对话</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredMessages.map((msg, i) => {
                  if (msg.role === 'tool') {
                    // 内部工具不显示（静默执行）
                    const hiddenTools = ['call_internal_api', 'ui_action']
                    if (hiddenTools.includes(msg.tool_name || '')) {
                      return null
                    }
                    // 交互式组件特殊渲染
                    if (msg.interactive && !msg.interactive_answered) {
                      return (
                        <div key={msg.id || i} className="flex gap-1.5 items-start">
                          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 bg-accent/20 border border-accent/40 mt-0.5">
                            <Sparkles size={8} className="text-accent" />
                          </div>
                          <InteractiveWidgetInline
                            interactive={msg.interactive}
                            onRespond={(response) => {
                              const state = useChatStore.getState()
                              const msgs = [...state.messages]
                              if (i < msgs.length) {
                                msgs[i] = { ...msgs[i], interactive_answered: true, content: response }
                                useChatStore.setState({ messages: msgs })
                              }
                              state.sendMessage(response, undefined, undefined)
                            }}
                          />
                        </div>
                      )
                    }

                    return (
                      <div key={msg.id || i} className="flex gap-1.5">
                        <div className="w-4 h-4 rounded-full bg-bg-tertiary text-text-muted flex items-center justify-center flex-shrink-0">
                          {msg.tool_pending ? (
                            <Loader2 size={8} className="animate-spin text-purple-500" />
                          ) : (
                            <Terminal size={8} />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-[9px] text-text-dim mb-0.5">
                            {msg.tool_name === 'call_internal_api' ? '内部调用' :
                             msg.tool_name === 'request_user_input' ? '交互' :
                             msg.tool_name || '工具'}
                          </div>
                          <div className="px-2 py-1 rounded bg-bg-tertiary/50 text-[10px] text-text-secondary border border-border/50">
                            {msg.tool_summary && <div className="text-accent font-medium mb-0.5">{msg.tool_summary}</div>}
                            {msg.tool_pending ? (
                              <span className="text-text-muted italic">执行中…</span>
                            ) : msg.tool_result ? (
                              <pre className="whitespace-pre-wrap font-sans break-all max-h-32 overflow-y-auto">{msg.tool_result}</pre>
                            ) : (
                              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  }
                  const hasThink = msg.think_content && msg.think_content.length > 0
                  return (
                    <div key={msg.id || i} className={`flex gap-1.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-muted'}`}>
                        {msg.role === 'user' ? <User size={8} /> : <Bot size={8} />}
                      </div>
                      <div className={`max-w-[88%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`text-[9px] text-text-dim mb-0.5 ${msg.role === 'user' ? 'text-right' : ''}`}>
                          {msg.role === 'user' ? '我' : msg.agent_name || 'AI'}
                        </div>
                        {hasThink && showThink && (
                          <div className="mb-0.5 text-left">
                            <div className="px-2 py-1 rounded bg-purple-500/5 border border-purple-500/20 text-[10px] text-text-muted">
                              <div className="flex items-center gap-0.5 mb-0.5 text-purple-500 font-medium text-[9px]">
                                <Sparkles size={8} /> 思考
                              </div>
                              <pre className="whitespace-pre-wrap font-sans text-[10px]">{msg.think_content}</pre>
                            </div>
                          </div>
                        )}
                        <div className={`px-2 py-1 rounded text-[11px] text-left ${msg.role === 'user' ? 'bg-accent text-white rounded-br-none' : 'bg-bg-tertiary text-text-secondary rounded-bl-none'}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}
                            components={{
                              code: ({ node, className, children, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '')
                                return match ? (
                                  <code className={`${className} block bg-black/20 rounded px-1 py-0.5 my-0.5 overflow-x-auto text-[10px]`} {...props}>
                                    {children}
                                  </code>
                                ) : (
                                  <code className="bg-black/20 rounded px-0.5 py-px text-[10px]" {...props}>{children}</code>
                                )
                              },
                              p: ({ children }) => <p className="my-0.5">{children}</p>,
                              ul: ({ children }) => <ul className="list-disc list-inside my-0.5 space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside my-0.5 space-y-0.5">{children}</ol>,
                            }}>
                            {msg.content || ''}
                          </ReactMarkdown>
                        </div>
                        {msg.output_files && msg.output_files.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-0.5 justify-start">
                            {msg.output_files.map((f, idx) => (
                              <div key={idx} className="inline-flex items-center gap-0.5 rounded bg-green-500/10 border border-green-500/30 overflow-hidden">
                                <button onClick={() => setPreviewPath(f.path)} className="p-0.5 text-green-600 hover:bg-green-500/20">
                                  <Eye size={8} />
                                </button>
                                <span className="text-[8px] text-green-700 px-0.5">{f.name}</span>
                                <a href={ideApi.downloadUrl(f.path)} download={f.name} className="p-0.5 text-green-600 hover:bg-green-500/20">
                                  <Download size={8} />
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {streaming && (
                  <div className="flex gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-bg-tertiary text-text-muted flex items-center justify-center flex-shrink-0">
                      <Loader2 size={8} className="animate-spin" />
                    </div>
                    <div className="px-2 py-1 rounded bg-bg-tertiary text-text-secondary rounded-bl-none text-[11px]">
                      <span className="animate-pulse">思考中…</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* 附件栏 */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 py-0.5 border-t border-border bg-bg-tertiary/50">
              {attachments.map((a: any, i) => (
                <div key={a.id || i} className="flex items-center gap-0.5 rounded bg-bg-secondary px-1.5 py-0.5 text-[9px] text-text-muted">
                  {a.kind === 'image' ? <ImageIcon size={8} className="text-pink-500" /> :
                   a.kind === 'doc' ? <FileText size={8} className="text-blue-500" /> :
                   <Paperclip size={8} />}
                  <span className="text-text-secondary max-w-[100px] truncate">{a.filename}</span>
                  <button onClick={() => removeAttachment(a.id)} className="text-text-dim hover:text-red-500"><X size={7} /></button>
                </div>
              ))}
            </div>
          )}

          {/* 底部输入 + 状态栏 */}
          {sendQueue.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 flex-wrap border-t border-border">
              <span className="text-[9px] text-text-muted">队列 {sendQueue.length}</span>
              {sendQueue.map((q: any, i) => (
                <span key={i} className="text-[9px] px-1 py-px rounded bg-bg-tertiary border border-border text-text-secondary flex items-center gap-0.5 max-w-[150px]">
                  <ListTodo size={8} className="text-accent flex-shrink-0" />
                  <span className="truncate">{q.text}</span>
                  <button onClick={() => removeQueued(i)} className="hover:text-red-500"><X size={7} /></button>
                </span>
              ))}
              <button onClick={clearQueue} className="text-[9px] text-text-muted hover:text-text-secondary">清空</button>
            </div>
          )}

          {/* 底部输入 + 状态栏 */}
          <div className="border-t border-border p-1.5 bg-bg-secondary/50">
            <div className="flex gap-1 items-end relative">
              {/* 补全弹层镜像元素 */}
              <div ref={mirrorRef} style={{ position: 'absolute', visibility: 'hidden', top: 0, left: '-9999px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />

              {/* 自动补全弹层 */}
              {completion && completionPos && (
                <div className="absolute bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden z-30 min-w-[150px]"
                  style={{
                    left: Math.min(completionPos.left, 250),
                    bottom: completionPos.bottom + 6,
                  }}>
                  {completion.items.map((item, i) => (
                    <div key={item} onClick={() => applyCompletion(item)}
                      className={`px-2 py-1 text-[11px] cursor-pointer flex items-center gap-1.5 ${
                        i === completion.active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-tertiary'}`}>
                      {completion.kind === 'agent' ? <Bot size={9} /> : completion.kind === 'skill' ? <Sparkles size={9} /> : <Terminal size={9} />}
                      {item}
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => fileRef.current?.click()} className="p-1 text-text-muted hover:text-accent flex-shrink-0" title="上传文件">
                <Paperclip size={11} />
              </button>
              <input ref={fileRef} type="file" multiple className="hidden"
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={streaming ? "生成中…输入后排队发送" : "@Agent #技能 /命令 Enter发送 ↑历史"}
                rows={1}
                className="flex-1 bg-transparent text-[11px] text-text-primary resize-none focus:outline-none placeholder:text-text-dim min-h-[22px] max-h-24"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 96) + 'px'
                }}
              />
              {streaming ? (
                <>
                  <button onClick={doSend}
                    className="px-1.5 py-1 rounded border border-border text-[10px] text-text-secondary hover:bg-bg-tertiary flex-shrink-0 flex items-center gap-0.5"
                    disabled={!input.trim()}>
                    <ListTodo size={9} /> 排队
                  </button>
                  <button onClick={handlePause}
                    className="px-1.5 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] flex-shrink-0 flex items-center gap-0.5"><PauseIco size={9} /> 暂停</button>
                </>
              ) : (
                <button onClick={doSend} disabled={(!input.trim() && attachments.length === 0) || uploading || sending}
                  className="px-1.5 py-1 rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-50 flex-shrink-0 flex items-center gap-0.5 text-[10px]" title="发送">
                  {uploading || sending ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
                </button>
              )}
            </div>

            {/* 状态栏 */}
            <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] text-text-muted flex-wrap">
              <span className="flex items-center gap-0.5 flex-shrink-0"><Cpu size={9} />
                {context?.model || activeModel || llmConfig.model || '—'}</span>
              <span className="flex items-center gap-0.5 flex-1 min-w-[80px] max-w-[160px]">
                <span className="flex-shrink-0">上下文</span>
                <span className="flex-1 h-1 rounded-full bg-bg-tertiary overflow-hidden">
                  <span className={`h-full rounded-full ${contextColor}`}
                    style={{ width: `${Math.min(100, contextPct)}%` }} />
                </span>
                {context ? `${contextPct}%` : ''}
              </span>
              <span className="text-text-dim flex-shrink-0">{messages.length}条</span>
              <button onClick={() => setShowShortcuts(s => !s)} className="text-text-dim hover:text-text-secondary flex-shrink-0 hidden sm:block">
                <Keyboard size={9} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {taskOpen && <TaskDrawer open onClose={() => setTaskOpen(false)} />}
      {previewPath && <FilePreviewModal path={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  )
}

export default function WorkspacePage() {
  const navigate = useNavigate()
  const [tree, setTree] = useState<FsNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewNode, setPreviewNode] = useState<FsNode | null>(null)
  const [treeError, setTreeError] = useState('')
  const [msg, setMsg] = useState('')
  const [fontSize, setFontSize] = useState(14)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [chatWidth, setChatWidth] = useState(400)
  const [treeWidth, setTreeWidth] = useState(160)
  const [isDraggingTree, setIsDraggingTree] = useState(false)
  const [isDraggingChat, setIsDraggingChat] = useState(false)
  const [showTree, setShowTree] = useState(true)
  const [showChat, setShowChat] = useState(true)
  const [mdPreview, setMdPreview] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const treeDragStartRef = useRef<{ x: number; width: number } | null>(null)
  const chatDragStartRef = useRef<{ x: number; width: number } | null>(null)

  const loadTree = useCallback(async () => {
    setLoading(true); setTreeError('')
    try { const r = await ideApi.tree(); setTree(r.tree) }
    catch (e) { setTreeError((e as Error)?.message || '加载失败') }
    setLoading(false)
  }, [])

  useState(() => { loadTree() })

  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'ide-files' || detail.resource === 'tasks') {
        loadTree()
      }
    })
  }, [loadTree])

  // 监听 AI UI 操作事件
  useEffect(() => {
    return onUIAction((detail) => {
      switch (detail.action) {
        case 'toggle_file_tree':
          setShowTree(s => !s)
          break
        case 'toggle_chat_panel':
          setShowChat(s => !s)
          break
        case 'toggle_sidebar':
          setShowTree(s => !s)
          break
        case 'navigate':
          if (detail.params?.path) {
            navigate(detail.params.path)
          }
          break
        case 'new_chat':
          useChatStore.getState().newConversation()
          break
      }
    })
  }, [navigate])

  const openFile = useCallback(async (n: FsNode) => {
    if (n.type !== 'file') return
    try {
      if (!isTextFile(n.path)) {
        setCurrentPath(n.path)
        setContent('')
        setDirty(false)
        setMdPreview(false)
        return
      }
      const r = await ideApi.readFile(n.path)
      setCurrentPath(n.path); setContent(r.content); setDirty(false)
      // 切换文件时重置预览模式
      setMdPreview(false)
    } catch (e) { setTreeError((e as Error)?.message || '读取失败') }
  }, [])

  const debouncedSave = useCallback(async () => {
    if (!currentPath || !dirty) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    setSaveStatus('saving')
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await ideApi.writeFile(currentPath, content)
        setDirty(false)
        setSaveStatus('saved')
        setMsg('已保存')
        setTimeout(() => { setMsg('') }, 2000)
      } catch (e) {
        setTreeError((e as Error)?.message || '保存失败')
        setSaveStatus('idle')
      }
    }, 800)
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current) }
  }, [currentPath, dirty, content])

  useEffect(() => {
    if (dirty) {
      debouncedSave()
    } else {
      setSaveStatus('idle')
    }
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [dirty, debouncedSave])

  const run = async () => {
    if (!currentPath) return
    setRunning(true); setRunResult(null)
    try {
      if (dirty) { await ideApi.writeFile(currentPath, content); setDirty(false) }
      setRunResult(await ideApi.run(currentPath))
    } catch (e) { setTreeError((e as Error)?.message || '运行失败') }
    setRunning(false)
  }

  const removeNode = async (n: FsNode) => {
    if (!confirm(`删除 ${n.path}？`)) return
    try { await ideApi.deleteFile(n.path); if (currentPath === n.path) { setCurrentPath(''); setContent('') }; loadTree() }
    catch (e) { setTreeError((e as Error)?.message || '删除失败') }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) await ideApi.upload(f.name, f)
      setMsg(`已上传 ${files.length} 个文件`); await loadTree()
    } catch (e) { setTreeError((e as Error)?.message || '上传失败') }
    setUploading(false); e.target.value = ''
  }

  const newFile = async () => {
    const p = prompt('新文件路径（如 script.py）'); if (!p) return
    try { await ideApi.writeFile(p, ''); setMsg(`已创建 ${p}`); await loadTree(); await openFile({ name: p.split('/').pop() || p, path: p, type: 'file' }) }
    catch (e) { setTreeError((e as Error)?.message || '创建失败') }
  }

  const handleDownload = async (path: string, name: string) => {
    try {
      const token = localStorage.getItem('ai_hubs_token')
      const headers: Record<string, string> = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const response = await fetch(ideApi.downloadUrl(path), {
        method: 'GET',
        headers,
      })
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setTreeError((e as Error)?.message || '下载失败')
    }
  }

  const extensions = useMemo(() => {
    const lang = langOf(currentPath)
    const base = [autocompletion(), keymap.of(completionKeymap)]
    if (Array.isArray(lang)) {
      return [...lang, ...base]
    }
    return [lang, ...base]
  }, [currentPath])

  const handleTreeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingTree(true)
    treeDragStartRef.current = { x: e.clientX, width: treeWidth }
  }

  const handleChatMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingChat(true)
    chatDragStartRef.current = { x: e.clientX, width: chatWidth }
  }

  const handleTreeMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingTree) return
    const start = treeDragStartRef.current
    if (!start) return
    const delta = e.clientX - start.x
    const newWidth = Math.max(80, Math.min(360, start.width + delta))
    setTreeWidth(newWidth)
  }, [isDraggingTree])

  const handleChatMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingChat) return
    const start = chatDragStartRef.current
    if (!start) return
    const delta = start.x - e.clientX
    const newWidth = Math.max(180, Math.min(640, start.width + delta))
    setChatWidth(newWidth)
  }, [isDraggingChat])

  const handleMouseUp = useCallback(() => {
    setIsDraggingTree(false)
    setIsDraggingChat(false)
  }, [])

  useEffect(() => {
    if (isDraggingTree || isDraggingChat) {
      document.addEventListener('mousemove', isDraggingTree ? handleTreeMouseMove : handleChatMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', isDraggingTree ? handleTreeMouseMove : handleChatMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingTree, isDraggingChat, handleTreeMouseMove, handleChatMouseMove, handleMouseUp])

  return (
    <div className="flex h-full overflow-hidden" ref={containerRef}>
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowTree(!showTree)} className="p-1 rounded text-text-muted hover:text-text-primary" title={showTree ? '隐藏文件树' : '显示文件树'}>
              {showTree ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
            </button>
            <div className="w-px h-3 bg-border" />
            <button onClick={newFile} className="p-1 rounded text-text-muted hover:text-text-primary" title="新建文件"><Plus size={12} /></button>
            <button onClick={loadTree} className="p-1 rounded text-text-muted hover:text-text-primary" title="刷新文件"><RefreshCw size={12} /></button>
            <button onClick={() => uploadRef.current?.click()} disabled={uploading} className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-40" title="上传文件"><Upload size={12} /></button>
            <input ref={uploadRef} type="file" multiple className="hidden" onChange={handleUpload} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowChat(!showChat)} className="p-1 rounded text-text-muted hover:text-text-primary" title={showChat ? '隐藏对话' : '显示对话'}>
              {showChat ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
            </button>
            <div className="w-px h-3 bg-border" />
            <button onClick={() => setFontSize(f => Math.max(10, f - 2))} className="p-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors" title="缩小字体"><ZoomOut size={12} /></button>
            <span className="text-[10px] text-text-dim w-8 text-center hidden sm:inline">{fontSize}px</span>
            <button onClick={() => setFontSize(f => Math.min(24, f + 2))} className="p-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors" title="放大字体"><ZoomIn size={12} /></button>
            <button onClick={() => setFontSize(14)} className="p-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors" title="重置字体"><Maximize2 size={12} /></button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {showTree && (
            <>
              <div className="flex flex-col flex-shrink-0" style={{ width: `${treeWidth}px` }}>
                <div className="flex-1 overflow-y-auto py-1 text-xs">
                  {loading ? <div className="p-2 text-text-dim">加载中…</div> :
                   treeError ? <div className="p-2 text-red-400">{treeError}</div> :
                   tree ? <TreeNode node={tree} depth={0} onOpen={openFile} activePath={currentPath} onDelete={removeNode} onPreview={setPreviewNode} onDownload={handleDownload} /> :
                   <div className="p-2 text-text-dim">空工作区</div>}
                </div>
                {msg && <div className="px-2 py-1 text-[10px] text-green-400 border-t border-border truncate">{msg}</div>}
              </div>

              <div className="w-1.5 hover:w-1 bg-border hover:bg-accent/40 cursor-col-resize transition-all flex-shrink-0 flex items-center justify-center group"
                onMouseDown={handleTreeMouseDown}>
                <GripVertical size={10} className="text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </>
          )}

          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary flex-shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Code2 size={13} className="text-accent flex-shrink-0" />
                <span className="text-xs text-text-primary truncate">{currentPath || '未打开文件'}{dirty && saveStatus === 'saving' && <span className="text-amber-500 ml-1">● 保存中…</span>}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {saveStatus === 'saved' && <span className="text-[10px] text-green-500">已保存</span>}
                {currentPath && currentPath.toLowerCase().endsWith('.md') && (
                  <button onClick={() => setMdPreview(!mdPreview)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-text-muted hover:text-text-primary hover:border-neutral-500 transition-colors text-[10px]"
                    title={mdPreview ? '切换到编辑模式' : '切换到预览模式'}>
                    {mdPreview ? <Code2 size={10} /> : <Eye size={10} />}
                    {mdPreview ? '编辑' : '预览'}
                  </button>
                )}
                <button onClick={run} disabled={running || !currentPath}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-green-500 bg-green-500/10 text-green-600 hover:bg-green-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[10px]"
                  title={running ? '运行中…' : '运行代码'}>
                  <Play size={10} />
                  {running ? '运行中' : '运行'}
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {currentPath ? (
                content || isTextFile(currentPath) ? (
                  currentPath.toLowerCase().endsWith('.md') && mdPreview ? (
                    <div className="h-full overflow-y-auto p-4 bg-bg-primary text-text-secondary prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}
                        components={{
                          code: ({ node, className, children, ...props }: any) => {
                            const match = /language-(\w+)/.exec(className || '')
                            return match ? (
                              <pre className="bg-bg-tertiary rounded p-2 overflow-x-auto my-2">
                                <code className={className} {...props}>{children}</code>
                              </pre>
                            ) : (
                              <code className="bg-bg-tertiary px-1 rounded" {...props}>{children}</code>
                            )
                          },
                          h1: ({ children }) => <h1 className="text-xl font-bold mb-3 mt-4 text-text-primary border-b border-border pb-1">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3 text-text-primary">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-base font-bold mb-1.5 mt-2 text-text-primary">{children}</h3>,
                          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc list-inside my-2 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside my-2 space-y-0.5">{children}</ol>,
                          blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/50 pl-3 my-2 text-text-dim italic">{children}</blockquote>,
                          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="min-w-full border border-border rounded">{children}</table></div>,
                          th: ({ children }) => <th className="border border-border px-2 py-1 text-left text-xs font-medium text-text-muted bg-bg-tertiary">{children}</th>,
                          td: ({ children }) => <td className="border border-border px-2 py-1 text-xs">{children}</td>,
                          a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>,
                          img: ({ src, alt }) => <img src={src} alt={alt || ''} className="max-w-full rounded my-2" />,
                          hr: () => <hr className="my-4 border-border" />,
                        }}>
                        {content || ''}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <CodeMirror key={currentPath} value={content} height="100%" theme={oneDark} extensions={extensions}
                      onChange={val => { setContent(val); setDirty(true) }} className="h-full" style={{ fontSize: `${fontSize}px` }} />
                  )
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-text-dim text-sm bg-bg-tertiary">
                    <FileCode size={48} className="mb-4 opacity-30" />
                    <p>二进制文件，无法在编辑器中显示</p>
                    <p className="text-xs mt-1">请使用预览按钮查看或下载</p>
                  </div>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-text-dim text-xs">从左侧选择文件开始编辑</div>
              )}
            </div>
            {runResult && (
              <div className="h-32 sm:h-36 flex-shrink-0 border-t border-border bg-bg-secondary flex flex-col">
                <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border text-xs text-text-muted flex-shrink-0">
                  <Terminal size={12} /> 输出
                  <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${runResult.exit_code === 0 ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-400'}`}>exit {runResult.exit_code}</span>
                  <button onClick={() => setRunResult(null)} className="ml-auto text-text-dim hover:text-text-primary">×</button>
                </div>
                <pre className="flex-1 overflow-auto p-2 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-words">
                  {runResult.stdout}{runResult.stderr && <span className="text-red-400">{runResult.stderr}</span>}
                  {!runResult.stdout && !runResult.stderr && <span className="text-text-dim">无输出</span>}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {showChat && (
        <>
          <div className="w-1.5 hover:w-1 bg-border hover:bg-accent/40 cursor-col-resize transition-all flex-shrink-0 flex items-center justify-center group"
            onMouseDown={handleChatMouseDown}>
            <GripVertical size={10} className="text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          <div className="flex-shrink-0" style={{ width: `${chatWidth}px` }}>
            <ChatPanel />
          </div>
        </>
      )}

      {previewNode && (
        <FilePreviewModal path={previewNode.path} title={previewNode.name} onClose={() => setPreviewNode(null)} />
      )}
    </div>
  )
}

// ── 交互式组件（简化版，适配工作空间小尺寸）──
function InteractiveWidgetInline({ interactive, onRespond }: {
  interactive: NonNullable<import('../api/chat').ChatMessage['interactive']>
  onRespond: (response: string) => void
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])

  const { interaction_type, title, message, options, fields, confirm_text, cancel_text } = interactive

  if (interaction_type === 'confirm') {
    return (
      <div className="max-w-[88%] px-2 py-1.5 rounded bg-accent/5 border border-accent/20 text-[11px]">
        <div className="font-medium text-text-primary mb-0.5">{title}</div>
        <div className="text-text-muted text-[10px] mb-2">{message}</div>
        <div className="flex gap-2">
          <button onClick={() => onRespond('确认')}
            className="px-3 py-1 rounded text-[10px] font-medium bg-accent text-white hover:bg-accent/80">
            {confirm_text}
          </button>
          <button onClick={() => onRespond('取消')}
            className="px-3 py-1 rounded text-[10px] font-medium border border-border text-text-muted hover:text-text-primary">
            {cancel_text}
          </button>
        </div>
      </div>
    )
  }

  if (interaction_type === 'select' && options) {
    return (
      <div className="max-w-[88%] px-2 py-1.5 rounded bg-accent/5 border border-accent/20 text-[11px]">
        <div className="font-medium text-text-primary mb-0.5">{title}</div>
        <div className="text-text-muted text-[10px] mb-2">{message}</div>
        <div className="flex flex-col gap-1">
          {options.map((opt) => (
            <button key={opt.value} onClick={() => onRespond(opt.value)}
              className="text-left px-2 py-1 rounded text-[10px] border border-border text-text-secondary hover:border-accent/50 hover:text-accent">
              <span className="font-medium">{opt.label}</span>
              {opt.description && <span className="text-text-muted ml-1">{opt.description}</span>}
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
      <div className="max-w-[88%] px-2 py-1.5 rounded bg-accent/5 border border-accent/20 text-[11px]">
        <div className="font-medium text-text-primary mb-0.5">{title}</div>
        <div className="text-text-muted text-[10px] mb-2">{message}</div>
        <div className="flex flex-col gap-1 mb-2">
          {options.map((opt) => (
            <label key={opt.value}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border cursor-pointer ${
                selectedOptions.includes(opt.value)
                  ? 'border-accent/50 text-accent bg-accent/5'
                  : 'border-border text-text-muted'
              }`}>
              <input type="checkbox" checked={selectedOptions.includes(opt.value)}
                onChange={() => toggleOption(opt.value)} className="sr-only" />
              <div className={`w-3 h-3 rounded border flex items-center justify-center ${
                selectedOptions.includes(opt.value) ? 'bg-accent border-accent' : 'border-neutral-600'
              }`}>
                {selectedOptions.includes(opt.value) && <Check size={8} className="text-white" />}
              </div>
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        <button onClick={() => onRespond(selectedOptions.join(', '))}
          disabled={selectedOptions.length === 0}
          className="px-3 py-1 rounded text-[10px] font-medium bg-accent text-white hover:bg-accent/80 disabled:opacity-40">
          确认 ({selectedOptions.length})
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
      <div className="max-w-[88%] px-2 py-1.5 rounded bg-accent/5 border border-accent/20 text-[11px]">
        <div className="font-medium text-text-primary mb-0.5">{title}</div>
        <div className="text-text-muted text-[10px] mb-2">{message}</div>
        <div className="flex flex-col gap-1.5 mb-2">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="block text-[10px] text-text-muted mb-0.5">{field.label}{field.required ? ' *' : ''}</label>
              {field.type === 'textarea' ? (
                <textarea value={formValues[field.name] || ''}
                  onChange={e => setFormValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder} rows={2}
                  className="w-full bg-bg-tertiary border border-border rounded px-2 py-1 text-[10px] text-text-primary outline-none focus:border-accent/50 resize-none" />
              ) : field.type === 'select' && field.options ? (
                <select value={formValues[field.name] || field.default || ''}
                  onChange={e => setFormValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                  className="w-full bg-bg-tertiary border border-border rounded px-2 py-1 text-[10px] text-text-primary outline-none focus:border-accent/50">
                  <option value="">请选择…</option>
                  {field.options.map((o: any) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input type={field.type === 'password' ? 'password' : 'text'}
                  value={formValues[field.name] || field.default || ''}
                  onChange={e => setFormValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full bg-bg-tertiary border border-border rounded px-2 py-1 text-[10px] text-text-primary outline-none focus:border-accent/50" />
              )}
            </div>
          ))}
        </div>
        <button onClick={handleSubmit}
          className="px-3 py-1 rounded text-[10px] font-medium bg-accent text-white hover:bg-accent/80">
          提交
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-[88%] px-2 py-1.5 rounded bg-accent/5 border border-accent/20 text-[11px]">
      <div className="font-medium text-text-primary">{title}</div>
      <div className="text-text-muted text-[10px]">{message}</div>
    </div>
  )
}
