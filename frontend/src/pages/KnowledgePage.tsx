import { useState, useEffect, useRef } from 'react'
import { BookOpen, Plus, Search, Upload, FileText, Download, Trash2, RefreshCw, X, ChevronRight, ChevronDown, Database, Sparkles, Eye, Settings, Star, FolderOpen, Layers } from 'lucide-react'
import { api, ideApi } from '../api/client'
import { FilePreviewModal } from '../components/FilePreviewModal'

interface KnowledgeBase {
  id: number
  name: string
  description: string
  category: string
  embedding_provider: string
  embedding_model: string
  chunk_size: number
  chunk_overlap: number
  top_k: number
  doc_count: number
  chunk_count: number
  is_default: boolean
  created_at: string | null
  updated_at: string | null
}

interface KnowledgeDoc {
  id: number
  kb_id: number
  source_id: string
  name: string
  filename: string
  path: string
  size: number
  chunks: number
  file_type: string
  created_at: string | null
  updated_at: string | null
}

interface SearchResult {
  text: string
  score: number
  source: string
  chunk_id: string
  doc_id: number | null
}

export default function KnowledgePage() {
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [activeKb, setActiveKb] = useState<KnowledgeBase | null>(null)
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [docLoading, setDocLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', category: 'general' })

  const [showSettings, setShowSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState<any>({})

  const loadBases = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get<KnowledgeBase[]>('/knowledge/bases')
      setBases(r || [])
      if (r && r.length > 0 && !activeKb) {
        const def = r.find(b => b.is_default) || r[0]
        setActiveKb(def)
      }
    } catch (e) {
      setError((e as Error)?.message || '加载失败')
    }
    setLoading(false)
  }

  const loadDocs = async (kbId: number) => {
    setDocLoading(true)
    setError('')
    try {
      const r = await api.get<KnowledgeDoc[]>(`/knowledge/bases/${kbId}/docs`)
      setDocs(r || [])
    } catch (e) {
      setError((e as Error)?.message || '加载文档失败')
    }
    setDocLoading(false)
  }

  useEffect(() => {
    loadBases()
  }, [])

  useEffect(() => {
    if (activeKb) {
      loadDocs(activeKb.id)
    }
  }, [activeKb?.id])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !activeKb) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      for (const f of Array.from(files)) {
        formData.append('files', f)
      }
      await api.form(`/knowledge/bases/${activeKb.id}/upload`, formData)
      setMsg(`已上传 ${files.length} 个文件到「${activeKb.name}」`)
      await loadDocs(activeKb.id)
      await loadBases()
    } catch (e) {
      setError((e as Error)?.message || '上传失败')
    }
    setUploading(false)
    e.target.value = ''
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || !activeKb) return
    setSearching(true)
    setError('')
    try {
      const r = await api.post<SearchResult[]>(`/knowledge/bases/${activeKb.id}/search`, { query: searchQuery })
      setSearchResults(r || [])
    } catch (e) {
      setError((e as Error)?.message || '搜索失败')
    }
    setSearching(false)
  }

  const handleDeleteDoc = async (docId: number) => {
    if (!activeKb) return
    if (!confirm('确定删除此文档？')) return
    try {
      await api.delete(`/knowledge/bases/${activeKb.id}/docs/${docId}`)
      await loadDocs(activeKb.id)
      await loadBases()
      setMsg('删除成功')
    } catch (e) {
      setError((e as Error)?.message || '删除失败')
    }
  }

  const handleCreateKb = async () => {
    setError('')
    try {
      const r = await api.post<KnowledgeBase>('/knowledge/bases', createForm)
      setMsg(`知识库「${r.name}」已创建`)
      setShowCreate(false)
      setCreateForm({ name: '', description: '', category: 'general' })
      await loadBases()
      setActiveKb(r)
    } catch (e: any) {
      setError(e?.message || '创建失败')
    }
  }

  const handleDeleteKb = async (kb: KnowledgeBase) => {
    if (!confirm(`确定删除知识库「${kb.name}」及其全部文档？`)) return
    try {
      await api.delete(`/knowledge/bases/${kb.id}`)
      setMsg('知识库已删除')
      if (activeKb?.id === kb.id) {
        setActiveKb(null)
      }
      await loadBases()
    } catch (e: any) {
      setError(e?.message || '删除失败')
    }
  }

  const handleSetDefault = async (kb: KnowledgeBase) => {
    try {
      await api.put(`/knowledge/bases/${kb.id}`, { is_default: true })
      setMsg(`已设「${kb.name}」为默认知识库`)
      await loadBases()
    } catch (e: any) {
      setError(e?.message || '设置失败')
    }
  }

  const openSettings = (kb: KnowledgeBase) => {
    setSettingsForm({
      name: kb.name,
      description: kb.description,
      category: kb.category,
      embedding_model: kb.embedding_model,
      chunk_size: kb.chunk_size,
      chunk_overlap: kb.chunk_overlap,
      top_k: kb.top_k,
    })
    setShowSettings(true)
  }

  const saveSettings = async () => {
    if (!activeKb) return
    try {
      const r = await api.put<KnowledgeBase>(`/knowledge/bases/${activeKb.id}`, settingsForm)
      setActiveKb(r)
      setMsg('设置已保存')
      setShowSettings(false)
      await loadBases()
    } catch (e: any) {
      setError(e?.message || '保存失败')
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <div className="h-full flex">
      {/* 左侧知识库列表 */}
      <div className="w-56 border-r border-border bg-bg-tertiary/30 flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-accent" />
            <span className="text-sm font-medium text-text-primary">知识库</span>
          </div>
          <button onClick={() => setShowCreate(true)} className="p-1 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary" title="新建知识库">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="text-center text-text-dim text-xs py-4">加载中…</div>
          ) : bases.length === 0 ? (
            <div className="text-center text-text-dim text-xs py-4">暂无知识库</div>
          ) : (
            <div className="space-y-0.5 px-2">
              {bases.map(kb => (
                <div
                  key={kb.id}
                  onClick={() => setActiveKb(kb)}
                  className={`flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors group ${
                    activeKb?.id === kb.id
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                  }`}
                >
                  <FolderOpen size={14} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate flex items-center gap-1">
                      {kb.name}
                      {kb.is_default && <Star size={10} className="text-yellow-500 fill-yellow-500" />}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {kb.doc_count} 文档 · {kb.chunk_count} 块
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); openSettings(kb) }}
                      className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
                      title="设置"
                    >
                      <Settings size={11} />
                    </button>
                    {!kb.is_default && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSetDefault(kb) }}
                        className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-yellow-500"
                        title="设为默认"
                      >
                        <Star size={11} />
                      </button>
                    )}
                    {!kb.is_default && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteKb(kb) }}
                        className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <BookOpen size={22} className="text-accent" />
            <div>
              <h1 className="text-lg font-semibold text-text-primary">
                {activeKb ? activeKb.name : '知识库'}
              </h1>
              {activeKb && (
                <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                  <span>{activeKb.doc_count} 个文档</span>
                  <span>·</span>
                  <span>{activeKb.chunk_count} 个分块</span>
                  <span>·</span>
                  <span>{activeKb.embedding_model}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeKb && (
              <>
                <button onClick={() => openSettings(activeKb)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary text-sm transition-colors">
                  <Settings size={14} /> 设置
                </button>
                <button onClick={() => uploadRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-50 transition-colors">
                  <Upload size={14} /> 上传文档
                </button>
                <input ref={uploadRef} type="file" multiple className="hidden" onChange={handleUpload} />
              </>
            )}
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

        {activeKb ? (
          <div className="flex-1 overflow-auto px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className="bg-bg-secondary border border-border rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Database size={16} className="text-text-muted" />
                    <h2 className="text-sm font-medium text-text-primary">文档列表</h2>
                    <button onClick={() => loadDocs(activeKb.id)} className="ml-auto p-1 rounded text-text-muted hover:text-text-primary" title="刷新"><RefreshCw size={12} /></button>
                  </div>
                  {docLoading ? (
                    <div className="text-center text-text-dim py-8">加载中…</div>
                  ) : docs.length === 0 ? (
                    <div className="text-center text-text-dim py-8">
                      <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
                      <p>暂无文档，点击上方按钮上传</p>
                      <p className="text-xs text-text-muted mt-1">支持 .txt, .md, .py, .pdf, .docx 等格式</p>
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
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
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
                              <div className="flex justify-between mb-1">
                                <span>文件类型</span>
                                <span>.{doc.file_type}</span>
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
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-dim">
            <div className="text-center">
              <BookOpen size={48} className="mx-auto mb-3 opacity-30" />
              <p>选择或创建一个知识库开始</p>
            </div>
          </div>
        )}
      </div>

      {/* 新建知识库弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">新建知识库</h3>
              <button onClick={() => setShowCreate(false)} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-text-muted">名称</label>
                <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" placeholder="例如：产品文档库" />
              </div>
              <div>
                <label className="text-xs text-text-muted">分类</label>
                <input value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" placeholder="general" />
              </div>
              <div>
                <label className="text-xs text-text-muted">描述</label>
                <input value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" placeholder="知识库用途说明…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={handleCreateKb} disabled={!createForm.name.trim()}
                className="px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 知识库设置弹窗 */}
      {showSettings && activeKb && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">知识库设置 — {activeKb.name}</h3>
              <button onClick={() => setShowSettings(false)} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="text-xs text-text-muted">名称</label>
                <input value={settingsForm.name || ''} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
              </div>
              <div>
                <label className="text-xs text-text-muted">描述</label>
                <input value={settingsForm.description || ''} onChange={(e) => setSettingsForm({ ...settingsForm, description: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted">Embedding 模型</label>
                  <input value={settingsForm.embedding_model || ''} onChange={(e) => setSettingsForm({ ...settingsForm, embedding_model: e.target.value })}
                    className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-text-muted">分类</label>
                  <input value={settingsForm.category || ''} onChange={(e) => setSettingsForm({ ...settingsForm, category: e.target.value })}
                    className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-text-muted">分块大小</label>
                  <input type="number" value={settingsForm.chunk_size || 500} onChange={(e) => setSettingsForm({ ...settingsForm, chunk_size: Number(e.target.value) })}
                    className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-text-muted">重叠大小</label>
                  <input type="number" value={settingsForm.chunk_overlap || 50} onChange={(e) => setSettingsForm({ ...settingsForm, chunk_overlap: Number(e.target.value) })}
                    className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-text-muted">Top-K</label>
                  <input type="number" value={settingsForm.top_k || 5} onChange={(e) => setSettingsForm({ ...settingsForm, top_k: Number(e.target.value) })}
                    className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
                </div>
              </div>
              <p className="text-[10px] text-text-muted">
                注意：修改分块参数后，已有文档不会自动重新向量化，需删除后重新上传。
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={saveSettings} className="px-3 py-1.5 rounded bg-accent text-white text-sm">保存</button>
            </div>
          </div>
        </div>
      )}

      {previewPath && (
        <FilePreviewModal path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  )
}
