import { useState, useEffect, useRef } from 'react'
import { BookOpen, Plus, Search, Upload, FileText, Download, Trash2, RefreshCw, X, ChevronRight, ChevronDown, Database, Sparkles, Eye } from 'lucide-react'
import { api, ideApi } from '../api/client'
import { FilePreviewModal } from '../components/FilePreviewModal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface KnowledgeDoc {
  id: string
  name: string
  path: string
  size: number
  chunks: number
  created_at: string
}

interface SearchResult {
  text: string
  score: number
  source: string
  chunk_id: string
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const fetchDocs = async () => {
    setLoading(true)
    try {
      const r = await api.get<KnowledgeDoc[]>('/knowledge/docs')
      setDocs(r || [])
    } catch (e) {
      setError((e as Error)?.message || '加载失败')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchDocs()
  }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      for (const f of Array.from(files)) {
        formData.append('files', f)
      }
      await api.form('/knowledge/upload', formData)
      setMsg(`已上传 ${files.length} 个文件到知识库`)
      await fetchDocs()
    } catch (e) {
      setError((e as Error)?.message || '上传失败')
    }
    setUploading(false)
    e.target.value = ''
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setError('')
    try {
      const r = await api.post<SearchResult[]>('/knowledge/search', { query: searchQuery })
      setSearchResults(r || [])
    } catch (e) {
      setError((e as Error)?.message || '搜索失败')
    }
    setSearching(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此文档？')) return
    try {
      await api.delete(`/knowledge/docs/${id}`)
      await fetchDocs()
      setMsg('删除成功')
    } catch (e) {
      setError((e as Error)?.message || '删除失败')
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <BookOpen size={22} className="text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">知识库</h1>
          <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded">{docs.length} 个文档</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => uploadRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-50 transition-colors">
            <Upload size={14} /> 上传文档
          </button>
          <input ref={uploadRef} type="file" multiple className="hidden" onChange={handleUpload} />
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}
      {msg && (
        <div className="mx-6 mt-4 bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 px-4 py-2 rounded-lg text-sm" onClick={() => setMsg('')}>{msg}</div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="bg-bg-secondary border border-border rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Database size={16} className="text-text-muted" />
                <h2 className="text-sm font-medium text-text-primary">文档列表</h2>
                <button onClick={fetchDocs} className="ml-auto p-1 rounded text-text-muted hover:text-text-primary" title="刷新"><RefreshCw size={12} /></button>
              </div>
              {loading ? (
                <div className="text-center text-text-dim py-8">加载中…</div>
              ) : docs.length === 0 ? (
                <div className="text-center text-text-dim py-8">
                  <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
                  <p>暂无文档，点击上方按钮上传</p>
                  <p className="text-xs text-text-muted mt-1">支持 .txt, .md, .py, .pdf 等格式</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {docs.map(doc => (
                    <div key={doc.id}
                      className={`bg-bg-tertiary border border-border rounded-lg overflow-hidden transition-colors ${expandedId === doc.id ? 'border-accent/40' : 'hover:border-text-dim'}`}>
                      <div className="p-3 flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}>
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-accent/70" />
                          <span className="text-sm text-text-primary truncate">{doc.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-text-muted">{formatSize(doc.size)}</span>
                          <span className="text-[10px] text-text-muted">{doc.chunks} 块</span>
                          <button onClick={(e) => { e.stopPropagation(); setPreviewPath(doc.path) }}
                            className="p-1 text-text-muted hover:text-accent" title="预览"><Eye size={12} /></button>
                          <a href={ideApi.downloadUrl(doc.path)} download={doc.name}
                            className="p-1 text-text-muted hover:text-accent" title="下载"><Download size={12} /></a>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(doc.id) }}
                            className="p-1 text-text-muted hover:text-red-500 dark:hover:text-red-400" title="删除"><Trash2 size={12} /></button>
                          {expandedId === doc.id ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
                        </div>
                      </div>
                      {expandedId === doc.id && (
                        <div className="px-3 pb-3 border-t border-border pt-2 text-xs text-text-muted">
                          <div className="flex justify-between mb-1">
                            <span>创建时间</span>
                            <span>{doc.created_at?.slice(0, 16) || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>路径</span>
                            <span className="font-mono truncate max-w-[60%]">{doc.path}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-bg-secondary border border-border rounded-xl p-4 sticky top-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-accent" />
                <h2 className="text-sm font-medium text-text-primary">RAG 检索测试</h2>
              </div>
              <div className="flex gap-2 mb-3">
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none"
                  placeholder="输入问题检索知识库…" />
                <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50 transition-colors">
                  <Search size={14} />
                </button>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {searching ? (
                  <div className="text-center text-text-dim py-4">检索中…</div>
                ) : searchResults.length === 0 ? (
                  <div className="text-text-dim text-xs py-4">
                    {searchQuery ? '未找到相关文档' : '输入问题开始检索'}
                  </div>
                ) : searchResults.map((res, i) => (
                  <div key={i} className="bg-bg-tertiary rounded-lg p-3">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-accent">{res.source}</span>
                      <span className="text-text-muted">score {res.score.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-text-secondary line-clamp-3">
                      {res.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewPath && (
        <FilePreviewModal path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  )
}
