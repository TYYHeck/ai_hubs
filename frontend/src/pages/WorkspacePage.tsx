import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
import {
  Plus, Folder, RefreshCw, Upload, Download, Eye, Trash2,
  FileCode, FolderOpen, ChevronRight, ChevronDown,
  Play, Terminal, Code2, X, GripVertical,
  ZoomIn, ZoomOut, Maximize2, Menu,
  User, Bot, Loader2, FileText, Paperclip, Send,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import { ideApi, type FsNode, type RunResult } from '../api/client'
import { FilePreviewModal } from '../components/FilePreviewModal'
import { useChatStore } from '../stores/chatStore'

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
  const { conversations, currentConvId, selectConversation, newConversation, deleteConversation } = useChatStore()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div className="w-48 flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-[10px] text-text-muted">对话列表</span>
        <button onClick={() => newConversation()} className="p-0.5 text-text-muted hover:text-accent" title="新对话">
          <Plus size={10} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.map(c => (
          <div key={c.id}
            className={`px-2 py-1.5 text-xs cursor-pointer transition-colors ${
              currentConvId === c.id ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
            onClick={() => selectConversation(c.id)}
            onMouseEnter={() => setHoveredId(c.id)}
            onMouseLeave={() => setHoveredId(null)}>
            <div className="flex items-center justify-between">
              <span className="truncate flex-1">{c.title}</span>
              {hoveredId === c.id && (
                <button onClick={e => { e.stopPropagation(); deleteConversation(c.id) }} className="text-text-dim hover:text-red-500">
                  <X size={10} />
                </button>
              )}
            </div>
            <span className="text-[10px] text-text-dim">{c.updated_at?.slice(0, 10)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatPanel() {
  const {
    messages, streaming, error,
    attachments, uploading,
    sendMessage, clearError,
    addAttachments, removeAttachment,
    pauseGeneration,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [showSidebar, setShowSidebar] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return
    await sendMessage(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      const result = await addAttachments([file])
      if (result?.placeholder) {
        setInput(prev => prev ? `${prev} ${result.placeholder}` : result.placeholder)
      }
    }
    e.target.value = ''
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-bg-tertiary">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowSidebar(!showSidebar)} className="p-0.5 text-text-muted hover:text-text-primary" title="对话列表">
            <Menu size={12} />
          </button>
          <span className="text-xs text-text-muted font-medium">对话</span>
        </div>
        {streaming && (
          <button onClick={pauseGeneration} className="p-0.5 text-text-muted hover:text-red-500 dark:hover:text-red-400" title="中断生成">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden flex">
        {showSidebar && <ChatSidebar />}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
            {messages.map((msg, i) => {
              if (msg.role === 'tool') {
                return (
                  <div key={msg.id || i} className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-bg-tertiary text-text-muted flex items-center justify-center flex-shrink-0">
                      <Terminal size={12} />
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] text-text-dim mb-0.5">
                        {msg.tool_name === 'call_internal_api' ? '内部调用' :
                         msg.tool_name === 'request_user_input' ? '交互' :
                         msg.tool_name || '工具'}
                      </div>
                      <div className="px-3 py-1.5 rounded-lg bg-bg-tertiary/50 text-xs text-text-secondary border border-border/50">
                        {msg.tool_summary && <div className="text-accent font-medium mb-1">{msg.tool_summary}</div>}
                        {msg.tool_result || msg.content}
                      </div>
                    </div>
                  </div>
                )
              }
              return (
                <div key={msg.id || i} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-muted'}`}>
                    {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                  </div>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`text-xs text-text-muted mb-0.5 ${msg.role === 'user' ? 'text-right' : ''}`}>
                      {msg.role === 'user' ? '我' : msg.agent_name || 'AI'}
                    </div>
                    <div className={`px-3 py-1.5 rounded-lg text-xs ${msg.role === 'user' ? 'bg-accent text-white rounded-br-none' : 'bg-bg-tertiary text-text-secondary rounded-bl-none'}`}>
                      {msg.content}
                    </div>
                    {msg.output_files && msg.output_files.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 justify-start">
                        {msg.output_files.map((f, idx) => (
                          <div key={idx} className="inline-flex items-center gap-0.5 rounded bg-green-500/10 border border-green-500/30 overflow-hidden">
                            <button onClick={() => window.open(ideApi.downloadUrl(f.path), '_blank')} className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-500/20">
                              <Eye size={10} />
                            </button>
                            <span className="text-[10px] text-green-700 dark:text-green-500 px-1">{f.name}</span>
                            <a href={ideApi.downloadUrl(f.path)} download={f.name} className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-500/20">
                              <Download size={10} />
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
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-bg-tertiary text-text-muted flex items-center justify-center flex-shrink-0">
                  <Loader2 size={12} className="animate-spin" />
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-bg-tertiary text-text-secondary rounded-bl-none text-xs">
                  <span className="animate-pulse">AI 思考中…</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          {error && (
            <div className="px-3 py-1 bg-red-500/10 border-t border-red-500/30 text-red-400 text-xs flex items-center justify-between">
              <span>{error}</span>
              <button onClick={clearError}><X size={12} /></button>
            </div>
          )}
          <div className="border-t border-border px-3 py-2 bg-bg-tertiary">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-0.5 rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-muted">
                    <FileText size={10} />
                    <span>{a.filename}</span>
                    <button onClick={() => removeAttachment(i)}><X size={8} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()} className="p-2 text-text-muted hover:text-accent flex-shrink-0" title="上传文件">
                <Paperclip size={14} />
              </button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFileUpload} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息…"
                className="flex-1 bg-transparent text-xs text-text-primary resize-none focus:outline-none placeholder:text-text-dim"
                rows={1}
                style={{ minHeight: '24px' }}
              />
              <button onClick={handleSend} disabled={(input.trim() === '' && attachments.length === 0) || streaming} className="p-2 bg-accent hover:bg-accent-hover text-white disabled:opacity-50 flex-shrink-0 rounded transition-colors" title="发送">
                <Send size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function WorkspacePage() {
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
  const uploadRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadTree = useCallback(async () => {
    setLoading(true); setTreeError('')
    try { const r = await ideApi.tree(); setTree(r.tree) }
    catch (e) { setTreeError((e as Error)?.message || '加载失败') }
    setLoading(false)
  }, [])

  useState(() => { loadTree() })

  const openFile = useCallback(async (n: FsNode) => {
    if (n.type !== 'file') return
    try {
      if (!isTextFile(n.path)) {
        setCurrentPath(n.path)
        setContent('')
        setDirty(false)
        return
      }
      const r = await ideApi.readFile(n.path)
      setCurrentPath(n.path); setContent(r.content); setDirty(false)
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

  const handleTreeMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingTree || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const newWidth = e.clientX - rect.left
    setTreeWidth(Math.max(100, Math.min(300, newWidth)))
  }, [isDraggingTree])

  const handleChatMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingChat || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const newWidth = rect.right - e.clientX
    setChatWidth(Math.max(280, Math.min(600, newWidth)))
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
            <button onClick={run} disabled={running || !currentPath} className="p-1 rounded border border-green-500 bg-green-500/10 text-green-600 hover:bg-green-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors" title={running ? '运行中…' : '运行代码'}>
              <Play size={12} />
            </button>
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

              <div className="w-[1px] bg-border cursor-col-resize hover:bg-accent/50 transition-colors flex-shrink-0"
                onMouseDown={() => setIsDraggingTree(true)}>
                <GripVertical size={10} className="mx-auto text-text-dim" />
              </div>
            </>
          )}

          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary flex-shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Code2 size={13} className="text-accent flex-shrink-0" />
                <span className="text-xs text-text-primary truncate">{currentPath || '未打开文件'}{dirty && saveStatus === 'saving' && <span className="text-amber-500 ml-1">● 保存中…</span>}</span>
              </div>
              {saveStatus === 'saved' && <span className="text-[10px] text-green-500">已保存</span>}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {currentPath ? (
                content || isTextFile(currentPath) ? (
                  <CodeMirror key={currentPath} value={content} height="100%" theme={oneDark} extensions={extensions}
                    onChange={val => { setContent(val); setDirty(true) }} className="h-full" style={{ fontSize: `${fontSize}px` }} />
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
          <div className="w-[1px] bg-border cursor-col-resize hover:bg-accent/50 transition-colors flex-shrink-0"
            onMouseDown={() => setIsDraggingChat(true)}>
            <GripVertical size={10} className="mx-auto text-text-dim" />
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
