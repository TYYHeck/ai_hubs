import { useState, useEffect, useCallback, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  Code2, FileCode, Folder, FolderOpen, File, Plus, Save, Trash2, Play, RefreshCw,
  ChevronRight, ChevronDown, Terminal,
} from 'lucide-react'
import { ideApi, type FsNode, type RunResult } from '../api/client'

function langOf(path: string) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'py': return python()
    case 'js': case 'mjs': case 'jsx': case 'ts': case 'tsx': return javascript({ jsx: true })
    case 'json': return json()
    case 'html': case 'htm': return html()
    case 'css': return css()
    case 'md': return markdown()
    default: return []
  }
}

interface TreeNodeProps {
  node: FsNode
  depth: number
  onOpen: (n: FsNode) => void
  activePath: string
  onDelete: (n: FsNode) => void
}

function TreeNode({ node, depth, onOpen, activePath, onDelete }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2)
  const isDir = node.type === 'dir'
  const pad = { paddingLeft: `${depth * 14 + 8}px` }

  if (isDir) {
    return (
      <div>
        <div className="flex items-center gap-1 py-1 pr-2 hover:bg-bg-tertiary rounded cursor-pointer group" style={pad}>
          <button onClick={() => setOpen((v) => !v)} className="text-neutral-500">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {open ? <FolderOpen size={14} className="text-accent/80" /> : <Folder size={14} className="text-accent/80" />}
          <span className="text-sm text-neutral-300 flex-1 truncate">{node.name || 'workspace'}</span>
          {node.truncated && <span className="text-[10px] text-neutral-600">…</span>}
        </div>
        {open && node.children?.map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} activePath={activePath} onDelete={onDelete} />
        ))}
      </div>
    )
  }
  return (
    <div
      className={`flex items-center gap-1 py-1 pr-2 rounded cursor-pointer group ${activePath === node.path ? 'bg-accent/10 text-accent' : 'hover:bg-bg-tertiary text-neutral-300'}`}
      style={pad}
      onClick={() => onOpen(node)}
    >
      <span className="w-[14px]" />
      <FileCode size={14} className="text-neutral-500 flex-shrink-0" />
      <span className="text-sm flex-1 truncate">{node.name}</span>
      <button onClick={(e) => { e.stopPropagation(); onDelete(node) }}
        className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400" title="删除">
        <Trash2 size={12} /></button>
    </div>
  )
}

export default function IdePage() {
  const [tree, setTree] = useState<FsNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [currentPath, setCurrentPath] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)

  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  const loadTree = useCallback(async () => {
    setLoading(true)
    try { setTree(await ideApi.tree()) }
    catch (e: any) { setError(e?.message || '加载工作区失败') }
    setLoading(false)
  }, [])
  useEffect(() => { loadTree() }, [loadTree])

  const openFile = useCallback(async (n: FsNode) => {
    if (n.type !== 'file') return
    try {
      const r = await ideApi.readFile(n.path)
      setCurrentPath(n.path)
      setContent(r.content)
      setDirty(false)
    } catch (e: any) { setError(e?.message || '读取失败') }
  }, [])

  const save = async () => {
    if (!currentPath) return
    setError('')
    try {
      await ideApi.writeFile(currentPath, content)
      setDirty(false)
      setMsg(`已保存 ${currentPath}`)
    } catch (e: any) { setError(e?.message || '保存失败') }
  }

  const newFile = async () => {
    const p = prompt('新文件路径（相对于工作区，如 scripts/hello.py）')
    if (!p) return
    try {
      await ideApi.writeFile(p, '')
      setMsg(`已创建 ${p}`)
      await loadTree()
      await openFile({ name: p.split('/').pop() || p, path: p, type: 'file' })
    } catch (e: any) { setError(e?.message || '创建失败') }
  }

  const newFolder = async () => {
    const p = prompt('新文件夹路径（如 scripts）')
    if (!p) return
    try {
      await ideApi.mkdir(p)
      setMsg(`已创建文件夹 ${p}`)
      loadTree()
    } catch (e: any) { setError(e?.message || '创建失败') }
  }

  const removeNode = async (n: FsNode) => {
    if (!confirm(`确认删除 ${n.type === 'dir' ? '文件夹' : '文件'}「${n.path}」？`)) return
    try {
      await ideApi.deleteFile(n.path)
      setMsg(`已删除 ${n.path}`)
      if (currentPath === n.path) { setCurrentPath(''); setContent('') }
      loadTree()
    } catch (e: any) { setError(e?.message || '删除失败') }
  }

  const run = async () => {
    if (!currentPath) { setError('请先打开一个脚本文件'); return }
    setRunning(true)
    setRunResult(null)
    try {
      const r = await ideApi.run(currentPath)
      setRunResult(r)
    } catch (e: any) { setError(e?.message || '运行失败') }
    setRunning(false)
  }

  const extensions = useMemo(() => langOf(currentPath), [currentPath])

  return (
    <div className="flex h-full">
      {/* 文件树 */}
      <div className="w-64 flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs text-neutral-400">资源管理器</span>
          <div className="flex items-center gap-1">
            <button onClick={newFile} className="p-1 rounded text-neutral-400 hover:text-neutral-200" title="新建文件"><Plus size={14} /></button>
            <button onClick={newFolder} className="p-1 rounded text-neutral-400 hover:text-neutral-200" title="新建文件夹"><Folder size={14} /></button>
            <button onClick={loadTree} className="p-1 rounded text-neutral-400 hover:text-neutral-200" title="刷新"><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? <div className="text-xs text-neutral-600 p-3">加载中…</div> :
            tree ? <TreeNode node={tree} depth={0} onOpen={openFile} activePath={currentPath} onDelete={removeNode} /> :
            <div className="text-xs text-neutral-600 p-3">空工作区</div>}
        </div>
      </div>

      {/* 编辑区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {error && <div className="text-sm text-red-400 bg-red-500/10 border-b border-red-500/30 px-4 py-2">{error}</div>}
        {msg && <div className="text-sm text-green-400 bg-green-500/10 border-b border-green-500/30 px-4 py-2">{msg}</div>}

        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-2 min-w-0">
            <Code2 size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm text-neutral-200 truncate">
              {currentPath || '未打开文件'}
              {dirty && <span className="text-amber-400 ml-1">●</span>}
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
            <div className="h-full flex items-center justify-center text-neutral-600 text-sm">
              从左侧选择文件，或点击「+」新建文件开始编辑
            </div>
          )}
        </div>

        {/* 运行输出 */}
        {runResult && (
          <div className="h-48 flex-shrink-0 border-t border-border bg-bg-secondary flex flex-col">
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border text-xs text-neutral-400">
              <Terminal size={14} /> 输出
              <span className={`ml-2 px-2 py-0.5 rounded ${runResult.timed_out ? 'bg-red-500/15 text-red-400' : runResult.exit_code === 0 ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'}`}>
                exit {runResult.exit_code}{runResult.timed_out ? ' (timeout)' : ''}
              </span>
              <span className="text-neutral-600 ml-2 truncate">{runResult.command}</span>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-neutral-300 whitespace-pre-wrap">
              {runResult.stdout}
              {runResult.stderr && <span className="text-red-400">{runResult.stderr}</span>}
              {!runResult.stdout && !runResult.stderr && <span className="text-neutral-600">（无输出）</span>}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
