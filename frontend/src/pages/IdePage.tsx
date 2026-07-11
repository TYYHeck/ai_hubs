import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  Code2, FileCode, Folder, FolderOpen, Plus, Save, Trash2, Play, RefreshCw,
  ChevronRight, ChevronDown, Terminal, Monitor, Cloud, FolderOpen as FolderOpenIcon,
  Upload, Download, Eye,
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

  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

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

  const openFile = useCallback(async (n: FsNode) => {
    if (n.type !== 'file') return
    try {
      const r = isLocal && desktopIde ? await desktopIde.readFile(n.path) : await ideApi.readFile(n.path)
      setCurrentPath(n.path)
      setContent(r.content)
      setDirty(false)
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

  const extensions = useMemo(
    () => [langOf(currentPath), autocompletion(), keymap.of(completionKeymap)],
    [currentPath],
  )

  return (
    <div className="flex h-full">
      {/* 文件树 */}
      <div className="w-64 flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col">
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
            tree ? <TreeNode node={tree} depth={0} onOpen={openFile} activePath={currentPath} onDelete={removeNode} /> :
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
            <CodeMirror
              key={currentPath}
              value={content}
              height="100%"
              theme={oneDark}
              extensions={[extensions]}
              onChange={(val) => { setContent(val); setDirty(true) }}
              className="h-full text-sm"
            />
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
  )
}
