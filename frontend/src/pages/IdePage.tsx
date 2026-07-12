import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  Code2, FileCode, Folder, FolderOpen, Plus, Save, Trash2, Play, RefreshCw,
  ChevronRight, ChevronDown, Terminal, Monitor, Cloud, FolderOpen as FolderOpenIcon,
  Upload, Download, Eye, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'
import { ideApi, type FsNode, type RunResult, type WorkspaceUsage } from '../api/client'
import { FilePreviewModal } from '../components/FilePreviewModal'

// ── 桌面端本地 IDE 桥接（Electron preload 注入）──
interface DesktopIde {
  pickFolder: () => Promise<string | null>
  tree: (root: string) => Promise<FsNode | null>
  readFile: (abs: string) => Promise<{ path: string; name: string; content: string; size: number }>
  writeFile: (abs: string, content: string) => Promise<{ path: string; name: string; size: number }>
  mkdir: (abs: string) => Promise<{ path: string; type: string }>
  delete: (abs: string) => Promise<{ ok: boolean }>
  join: (root: string, rel: string) => Promise<string>
  run: (abs: string, args?: string[]) => Promise<RunResult>
}
const desktopIde: DesktopIde | undefined = (window as unknown as {
  aiHubsDesktop?: { ide?: DesktopIde }
}).aiHubsDesktop?.ide
const hasLocalIde = !!desktopIde

type IdeMode = 'local' | 'remote'

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
    case 'cpp': case 'cc': case 'cxx': case 'hpp': return cpp()
    case 'java': return java()
    default: return []
  }
}

interface TreeNodeProps {
  node: FsNode
  depth: number
  onOpen: (n: FsNode) => void
  activePath: string
  onDelete: (n: FsNode) => void
  onPreview: (n: FsNode) => void
}

function TreeNode({ node, depth, onOpen, activePath, onDelete, onPreview }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2)
  const isDir = node.type === 'dir'
  const pad = { paddingLeft: `${depth * 14 + 8}px` }

  if (isDir) {
    return (
      <div>
        <div className="flex items-center gap-1 py-1 pr-2 hover:bg-bg-tertiary rounded cursor-pointer group" style={pad}>
          <button onClick={() => setOpen((v) => !v)} className="text-text-muted">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {open ? <FolderOpen size={14} className="text-accent/80" /> : <Folder size={14} className="text-accent/80" />}
          <span className="text-sm text-text-secondary flex-1 truncate">{node.name || 'workspace'}</span>
          {node.truncated && <span className="text-[10px] text-text-dim">…</span>}
        </div>
        {open && node.children?.map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} activePath={activePath} onDelete={onDelete} onPreview={onPreview} />
        ))}
      </div>
    )
  }
  return (
    <div
      className={`flex items-center gap-1 py-1 pr-2 rounded cursor-pointer group ${activePath === node.path ? 'bg-accent/10 text-accent' : 'hover:bg-bg-tertiary text-text-secondary'}`}
      style={pad}
      onClick={() => onOpen(node)}
    >
      <span className="w-[14px]" />
      <FileCode size={14} className="text-text-muted flex-shrink-0" />
      <span className="text-sm flex-1 truncate">{node.name}</span>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        <button onClick={(e) => { e.stopPropagation(); onPreview(node) }}
          className="p-1 text-text-muted hover:text-accent" title="预览/下载">
          <Eye size={11} />
        </button>
        <a href={ideApi.downloadUrl(node.path)} download={node.name} onClick={(e) => e.stopPropagation()}
          className="p-1 text-text-muted hover:text-accent" title="下载">
          <Download size={11} />
        </a>
        <button onClick={(e) => { e.stopPropagation(); onDelete(node) }}
          className="p-1 text-text-muted hover:text-red-500 dark:hover:text-red-400" title="删除">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

export default function IdePage() {
  // 桌面端默认「本地」模式；纯网页只能用「远程」服务器工作区
  const [mode, setMode] = useState<IdeMode>(hasLocalIde ? 'local' : 'remote')
  const [rootPath, setRootPath] = useState('') // 本地模式的工作文件夹绝对路径

  const [tree, setTree] = useState<FsNode | null>(null)
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [currentPath, setCurrentPath] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [mdPreview, setMdPreview] = useState(false)
  const [fontSize, setFontSize] = useState(14)

  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [previewNode, setPreviewNode] = useState<FsNode | null>(null)

  const isLocal = mode === 'local'

  const loadTree = useCallback(async () => {
    setError('')
    if (isLocal) {
      if (!desktopIde || !rootPath) { setTree(null); return }
      setLoading(true)
      try { setTree(await desktopIde.tree(rootPath)) }
      catch (e) { setError((e as Error)?.message || '读取本地文件夹失败') }
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = await ideApi.tree()
      setTree(r.tree)
      setUsage(r.usage)
    }
    catch (e) { setError((e as Error)?.message || '加载远程工作区失败') }
    setLoading(false)
  }, [isLocal, rootPath])

  useEffect(() => { loadTree() }, [loadTree])

  // 切换模式时重置编辑区
  useEffect(() => {
    setCurrentPath(''); setContent(''); setDirty(false); setRunResult(null); setMsg('')
  }, [mode])

  const pickFolder = async () => {
    if (!desktopIde) return
    setError('')
    try {
      const dir = await desktopIde.pickFolder()
      if (dir) {
        setRootPath(dir)
        setCurrentPath(''); setContent(''); setDirty(false); setRunResult(null)
        setMsg(`已打开本地文件夹：${dir}`)
      }
    } catch (e) { setError((e as Error)?.message || '选择文件夹失败') }
  }

  const isTextFile = (path: string): boolean => {
    const textExts = ['py', 'js', 'mjs', 'jsx', 'ts', 'tsx', 'json', 'html', 'htm', 'css', 'md', 'txt', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'java', 'go', 'rs', 'php', 'sql', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log']
    const ext = path.split('.').pop()?.toLowerCase() || ''
    return textExts.includes(ext)
  }

  const openFile = useCallback(async (n: FsNode) => {
    if (n.type !== 'file') return
    try {
      if (!isTextFile(n.path)) {
        setCurrentPath(n.path)
        setContent('')
        setDirty(false)
        return
      }
      const r = isLocal && desktopIde ? await desktopIde.readFile(n.path) : await ideApi.readFile(n.path)
      setCurrentPath(n.path)
      setContent(r.content)
      setDirty(false)
      setMdPreview(false)
    } catch (e) { setError((e as Error)?.message || '读取失败') }
  }, [isLocal])

  const save = async () => {
    if (!currentPath) return
    setError('')
    try {
      if (isLocal && desktopIde) await desktopIde.writeFile(currentPath, content)
      else await ideApi.writeFile(currentPath, content)
      setDirty(false)
      setMsg(`已保存 ${currentPath}`)
    } catch (e) { setError((e as Error)?.message || '保存失败') }
  }

  const newFile = async () => {
    if (isLocal && !rootPath) { setError('请先打开本地文件夹'); return }
    const p = prompt(isLocal
      ? '新文件路径（相对当前文件夹，如 scripts/hello.py）'
      : '新文件路径（相对于工作区，如 scripts/hello.py）')
    if (!p) return
    try {
      const target = isLocal && desktopIde ? await desktopIde.join(rootPath, p) : p
      if (isLocal && desktopIde) await desktopIde.writeFile(target, '')
      else await ideApi.writeFile(target, '')
      setMsg(`已创建 ${target}`)
      await loadTree()
      await openFile({ name: p.split(/[\\/]/).pop() || p, path: target, type: 'file' })
    } catch (e) { setError((e as Error)?.message || '创建失败') }
  }

  const newFolder = async () => {
    if (isLocal && !rootPath) { setError('请先打开本地文件夹'); return }
    const p = prompt('新文件夹路径（如 scripts）')
    if (!p) return
    try {
      const target = isLocal && desktopIde ? await desktopIde.join(rootPath, p) : p
      if (isLocal && desktopIde) await desktopIde.mkdir(target)
      else await ideApi.mkdir(target)
      setMsg(`已创建文件夹 ${target}`)
      loadTree()
    } catch (e) { setError((e as Error)?.message || '创建失败') }
  }

  const removeNode = async (n: FsNode) => {
    if (!confirm(`确认删除 ${n.type === 'dir' ? '文件夹' : '文件'}「${n.path}」？`)) return
    try {
      if (isLocal && desktopIde) await desktopIde.delete(n.path)
      else await ideApi.deleteFile(n.path)
      setMsg(`已删除 ${n.path}`)
      if (currentPath === n.path) { setCurrentPath(''); setContent('') }
      loadTree()
    } catch (e) { setError((e as Error)?.message || '删除失败') }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true); setError('')
    try {
      for (const f of Array.from(files)) {
        await ideApi.upload(f.name, f)
      }
      setMsg(`已上传 ${files.length} 个文件`)
      await loadTree()
    } catch (err) { setError((err as Error)?.message || '上传失败') }
    setUploading(false)
    e.target.value = ''
  }

  const run = async () => {
    if (!currentPath) { setError('请先打开一个脚本文件'); return }
    setRunning(true)
    setRunResult(null)
    try {
      // 运行前先保存，确保执行的是编辑器内最新内容
      if (dirty) {
        if (isLocal && desktopIde) await desktopIde.writeFile(currentPath, content)
        else await ideApi.writeFile(currentPath, content)
        setDirty(false)
      }
      const r = isLocal && desktopIde
        ? await desktopIde.run(currentPath, [])
        : await ideApi.run(currentPath)
      setRunResult(r)
    } catch (e) { setError((e as Error)?.message || '运行失败') }
    setRunning(false)
  }

  const extensions = useMemo(() => {
    const lang = langOf(currentPath)
    const base = [autocompletion(), keymap.of(completionKeymap)]
    if (Array.isArray(lang)) {
      return [...lang, ...base]
    }
    return [lang, ...base]
  }, [currentPath])

  // 文件树宽度（可拖拽）
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false)

  // 拖拽起点：记录按下时的鼠标 X 与当时的宽度，按「相对位移」计算新宽度，
  // 避免用绝对 e.clientX 时受左侧应用侧边栏偏移影响（IDE 单独模式下会「跳到右边」）
  const dragStartRef = useRef<{ x: number; width: number } | null>(null)

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, width: sidebarWidth }
    setIsDraggingSidebar(true)
  }, [sidebarWidth])

  useEffect(() => {
    if (!isDraggingSidebar) return

    const handleMouseMove = (e: MouseEvent) => {
      const start = dragStartRef.current
      if (!start) return
      const delta = e.clientX - start.x
      const newWidth = Math.min(Math.max(140, start.width + delta), 400)
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      dragStartRef.current = null
      setIsDraggingSidebar(false)
    }

    // 拖拽期间禁用文本选中，避免选到编辑器内容
    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.body.style.userSelect = prevUserSelect
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingSidebar])

  return (
    <>
    <div className="flex h-full">
      {/* 文件树（可拖拽宽度） */}
      <div
        className="flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col"
        style={{ width: `${sidebarWidth}px` }}>
        {/* 模式切换 */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-1 bg-bg-tertiary rounded p-0.5">
            <button
              onClick={() => hasLocalIde && setMode('local')}
              disabled={!hasLocalIde}
              title={hasLocalIde ? '本地电脑文件夹' : '仅桌面客户端可用'}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${mode === 'local' ? 'bg-accent text-white' : 'text-text-muted'} ${!hasLocalIde ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Monitor size={12} /> 本地
            </button>
            <button
              onClick={() => setMode('remote')}
              title="服务器远程工作区（远程训练代码）"
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${mode === 'remote' ? 'bg-accent text-white' : 'text-text-muted'}`}
            >
              <Cloud size={12} /> 远程
            </button>
          </div>
          {isLocal && (
            <button onClick={pickFolder}
              className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-bg-tertiary text-xs text-text-secondary hover:text-text-primary">
              <FolderOpenIcon size={12} /> {rootPath ? '切换文件夹' : '打开文件夹'}
            </button>
          )}
          {isLocal && rootPath && (
            <div className="mt-1 text-[10px] text-text-dim truncate" title={rootPath}>{rootPath}</div>
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs text-text-muted">资源管理器</span>
          <div className="flex items-center gap-1">
            <button onClick={newFile} className="p-1 rounded text-text-muted hover:text-text-primary" title="新建文件"><Plus size={14} /></button>
            <button onClick={newFolder} className="p-1 rounded text-text-muted hover:text-text-primary" title="新建文件夹"><Folder size={14} /></button>
            <button onClick={loadTree} className="p-1 rounded text-text-muted hover:text-text-primary" title="刷新"><RefreshCw size={14} /></button>
            {!isLocal && (
              <>
                <button onClick={() => uploadInputRef.current?.click()} disabled={uploading}
                  className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-40" title="上传文件">
                  <Upload size={14} />
                </button>
                <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
              </>
            )}
          </div>
        </div>
        {!isLocal && usage && (
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
              <span>工作区空间</span>
              <span>{(usage.used / (1024 * 1024)).toFixed(1)} / {(usage.quota / (1024 * 1024)).toFixed(0)} MB</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className={`h-full rounded-full ${usage.used / usage.quota > 0.9 ? 'bg-red-500' : usage.used / usage.quota > 0.7 ? 'bg-amber-500' : 'bg-accent'}`}
                style={{ width: `${Math.min(100, (usage.used / usage.quota) * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? <div className="text-xs text-text-dim p-3">加载中…</div> :
            isLocal && !rootPath ? <div className="text-xs text-text-dim p-3">点击上方「打开文件夹」选择本地工作目录</div> :
            tree ? <TreeNode node={tree} depth={0} onOpen={openFile} activePath={currentPath} onDelete={removeNode} onPreview={setPreviewNode} /> :
            <div className="text-xs text-text-dim p-3">
              {error ? `加载失败：${error}` : '空工作区'}
              {!isLocal && !loading && (
                <button
                  onClick={async () => {
                    setError('')
                    try {
                      await ideApi.writeFile('welcome.txt',
                        '欢迎使用 AI Hubs 远程工作区！\n\n' +
                        '你可以在这里编写并运行代码（支持 Python / JS / C / C++ / Java 等）。\n' +
                        '点击左上角「+」新建文件，或运行本示例文件体验。')
                      setMsg('已创建示例文件 welcome.txt')
                      await loadTree()
                    } catch (e) { setError((e as Error)?.message || '创建失败') }
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-bg-tertiary text-xs text-text-secondary hover:text-text-primary"
                >
                  <Plus size={12} /> 创建示例文件
                </button>
              )}
            </div>}
        </div>
      </div>

      {/* 拖拽条 */}
      <div
        onMouseDown={handleSidebarMouseDown}
        className="w-1 bg-border cursor-col-resize hover:bg-accent/50 transition-colors flex-shrink-0 relative group"
        style={{ cursor: isDraggingSidebar ? 'col-resize' : 'col-resize' }}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-12 bg-text-dim/30 rounded-full group-hover:bg-accent/50" />
      </div>

      {/* 编辑区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border-b border-red-500/30 px-4 py-2">{error}</div>}
        {msg && <div className="text-sm text-green-600 dark:text-green-400 bg-green-500/10 border-b border-green-500/30 px-4 py-2">{msg}</div>}

        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-2 min-w-0">
            <Code2 size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm text-text-primary truncate">
              {currentPath || '未打开文件'}
              {dirty && <span className="text-amber-600 dark:text-amber-400 ml-1">●</span>}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${isLocal ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'}`}>
              {isLocal ? '本地' : '远程'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {currentPath && currentPath.toLowerCase().endsWith('.md') && (
              <button onClick={() => setMdPreview(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 text-sm transition-colors"
                title={mdPreview ? '切换到编辑模式' : '切换到预览模式'}>
                {mdPreview ? <Code2 size={14} /> : <Eye size={14} />}
                {mdPreview ? '编辑' : '预览'}
              </button>
            )}
            <div className="flex items-center gap-0.5">
              <button onClick={() => setFontSize(f => Math.max(10, f - 2))} className="p-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors" title="缩小字体"><ZoomOut size={13} /></button>
              <span className="text-[10px] text-text-dim w-8 text-center">{fontSize}px</span>
              <button onClick={() => setFontSize(f => Math.min(24, f + 2))} className="p-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors" title="放大字体"><ZoomIn size={13} /></button>
              <button onClick={() => setFontSize(14)} className="p-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors" title="重置字体"><Maximize2 size={13} /></button>
            </div>
            <button onClick={run} disabled={running || !currentPath}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-40">
              <Play size={14} /> {running ? '运行中…' : '运行'}
            </button>
            <button onClick={save} disabled={!currentPath || !dirty}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-40">
              <Save size={14} /> 保存
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {currentPath ? (
            content || isTextFile(currentPath) ? (
              currentPath.toLowerCase().endsWith('.md') && mdPreview ? (
                <div className="h-full overflow-y-auto p-4 bg-bg-primary text-text-secondary markdown-content md-editor-preview max-w-none" style={{ fontSize: `${fontSize}px` }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}
                    components={{
                      code: ({ node, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '')
                        return match ? (
                          <pre className="bg-bg-tertiary text-text-primary rounded p-2 overflow-x-auto my-2">
                            <code className={className} {...props}>{children}</code>
                          </pre>
                        ) : (
                          <code className="bg-bg-tertiary text-text-primary px-1 rounded" {...props}>{children}</code>
                        )
                      },
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
              <CodeMirror
                key={currentPath}
                value={content}
                height="100%"
                theme={oneDark}
                extensions={extensions}
                onChange={(val) => { setContent(val); setDirty(true) }}
                className="h-full text-sm" style={{ fontSize: `${fontSize}px` }}
              />
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-dim text-sm bg-bg-tertiary">
                <FileCode size={48} className="mb-4 opacity-30" />
                <p>二进制文件，无法在编辑器中显示</p>
                <p className="text-xs mt-1">请使用右侧预览按钮查看或下载</p>
              </div>
            )
          ) : (
            <div className="h-full flex items-center justify-center text-text-dim text-sm">
              {isLocal && !rootPath
                ? '先在左侧「打开文件夹」，即可编辑本地电脑上的代码并在本地运行'
                : '从左侧选择文件，或点击「+」新建文件开始编辑'}
            </div>
          )}
        </div>

        {/* 运行输出 */}
        {runResult && (
          <div className="h-48 flex-shrink-0 border-t border-border bg-bg-secondary flex flex-col">
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border text-xs text-text-muted">
              <Terminal size={14} /> 输出（{isLocal ? '本地电脑' : '远程服务器'}）
              <span className={`ml-2 px-2 py-0.5 rounded ${runResult.timed_out ? 'bg-red-500/15 text-red-600 dark:text-red-400' : runResult.exit_code === 0 ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}`}>
                exit {runResult.exit_code}{runResult.timed_out ? ' (timeout)' : ''}
              </span>
              <span className="text-text-dim ml-2 truncate">{runResult.command}</span>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-text-secondary whitespace-pre-wrap">
              {runResult.stdout}
              {runResult.stderr && <span className="text-red-600 dark:text-red-400">{runResult.stderr}</span>}
              {!runResult.stdout && !runResult.stderr && <span className="text-text-dim">（无输出）</span>}
            </pre>
          </div>
        )}
      </div>
    </div>
    {previewNode && !isLocal && (
      <FilePreviewModal path={previewNode.path} title={previewNode.name} onClose={() => setPreviewNode(null)} />
    )}
    </>
  )
}
