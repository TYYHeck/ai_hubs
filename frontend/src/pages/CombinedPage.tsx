// AI Hubs — 对话 + IDE 合并视图
// 布局：左侧文件树 | 中间编辑器+输出 | 右侧对话

import { useState, useCallback, useMemo, useRef } from 'react'
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
  Play, Save, Terminal, Code2,
} from 'lucide-react'
import { ideApi, type FsNode, type RunResult } from '../api/client'
import { FilePreviewModal } from '../components/FilePreviewModal'
import ChatPage from './ChatPage'

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

interface TreeNodeProps {
  node: FsNode; depth: number
  onOpen: (n: FsNode) => void
  activePath: string; onDelete: (n: FsNode) => void; onPreview: (n: FsNode) => void
}

function TreeNode({ node, depth, onOpen, activePath, onDelete, onPreview }: TreeNodeProps) {
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
          <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} activePath={activePath} onDelete={onDelete} onPreview={onPreview} />
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
        <a href={ideApi.downloadUrl(node.path)} download={node.name} onClick={e => e.stopPropagation()} className="p-0.5 text-text-muted hover:text-accent"><Download size={10} /></a>
        <button onClick={e => { e.stopPropagation(); onDelete(node) }} className="p-0.5 text-text-muted hover:text-red-500 dark:hover:text-red-400"><Trash2 size={10} /></button>
      </div>
    </div>
  )
}

export default function CombinedPage() {
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
  const uploadRef = useRef<HTMLInputElement>(null)

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
      const r = await ideApi.readFile(n.path)
      setCurrentPath(n.path); setContent(r.content); setDirty(false)
    } catch (e) { setTreeError((e as Error)?.message || '读取失败') }
  }, [])

  const save = async () => {
    if (!currentPath) return
    try { await ideApi.writeFile(currentPath, content); setDirty(false); setMsg('已保存') }
    catch (e) { setTreeError((e as Error)?.message || '保存失败') }
  }

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

  const extensions = useMemo(() => [langOf(currentPath), autocompletion(), keymap.of(completionKeymap)], [currentPath])

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左：文件树 */}
      <div className="w-52 flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
          <span className="text-xs text-text-muted font-medium">文件</span>
          <div className="flex items-center gap-0.5">
            <button onClick={newFile} className="p-1 rounded text-text-muted hover:text-text-primary" title="新建"><Plus size={12} /></button>
            <button onClick={loadTree} className="p-1 rounded text-text-muted hover:text-text-primary" title="刷新"><RefreshCw size={12} /></button>
            <button onClick={() => uploadRef.current?.click()} disabled={uploading} className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-40" title="上传"><Upload size={12} /></button>
            <input ref={uploadRef} type="file" multiple className="hidden" onChange={handleUpload} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1 text-xs">
          {loading ? <div className="p-2 text-text-dim">加载中…</div> :
           treeError ? <div className="p-2 text-red-400">{treeError}</div> :
           tree ? <TreeNode node={tree} depth={0} onOpen={openFile} activePath={currentPath} onDelete={removeNode} onPreview={setPreviewNode} /> :
           <div className="p-2 text-text-dim">空工作区</div>}
        </div>
        {msg && <div className="px-2 py-1 text-[10px] text-green-400 border-t border-border truncate">{msg}</div>}
      </div>

      {/* 中：编辑器 + 输出 */}
      <div className="flex flex-col" style={{ width: '40%', minWidth: 0, borderRight: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Code2 size={13} className="text-accent flex-shrink-0" />
            <span className="text-xs text-text-primary truncate">{currentPath || '未打开文件'}{dirty && <span className="text-amber-500 ml-1">●</span>}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={run} disabled={running || !currentPath} className="flex items-center gap-1 px-2 py-1 rounded bg-green-600 text-white text-xs disabled:opacity-40"><Play size={11} />{running ? '运行中…' : '运行'}</button>
            <button onClick={save} disabled={!currentPath || !dirty} className="flex items-center gap-1 px-2 py-1 rounded bg-accent text-white text-xs disabled:opacity-40"><Save size={11} />保存</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {currentPath ? (
            <CodeMirror key={currentPath} value={content} height="100%" theme={oneDark} extensions={[extensions]}
              onChange={val => { setContent(val); setDirty(true) }} className="h-full text-xs" />
          ) : (
            <div className="h-full flex items-center justify-center text-text-dim text-xs">从左侧选择文件开始编辑</div>
          )}
        </div>
        {runResult && (
          <div className="h-36 flex-shrink-0 border-t border-border bg-bg-secondary flex flex-col">
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

      {/* 右：对话 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <ChatPage />
      </div>

      {previewNode && (
        <FilePreviewModal path={previewNode.path} title={previewNode.name} onClose={() => setPreviewNode(null)} />
      )}
    </div>
  )
}
