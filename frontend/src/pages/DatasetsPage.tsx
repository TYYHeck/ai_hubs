import { useState, useEffect, useCallback } from 'react'
import { Database, Plus, Trash2, Upload, Download, X, FileJson, FileSpreadsheet, Table2, Search, Edit2, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { datasetApi, type Dataset, type DatasetRecord } from '../api/client'
import { onAIMutation } from '../stores/chatStore'

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', category: 'general' })

  const [active, setActive] = useState<Dataset | null>(null)
  const [records, setRecords] = useState<DatasetRecord[]>([])
  const [recLoading, setRecLoading] = useState(false)

  const [searchQ, setSearchQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 50

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState('')

  const [showAddRec, setShowAddRec] = useState(false)
  const [recJson, setRecJson] = useState('{\n  \n}')
  const [showImport, setShowImport] = useState(false)
  const [importFmt, setImportFmt] = useState<'json' | 'csv'>('json')
  const [importText, setImportText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setDatasets(await datasetApi.list()) }
    catch (e: any) { setError(e?.message || '加载失败') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'datasets') load()
    })
  }, [load])

  const loadRecords = useCallback(async (id: number, resetPage = false) => {
    if (resetPage) setPage(1)
    setRecLoading(true)
    setError('')
    try {
      if (searchQ.trim()) {
        setSearching(true)
        const r = await datasetApi.search(id, searchQ, pageSize, (page - 1) * pageSize)
        setRecords(r)
        setSearching(false)
      } else {
        setRecords(await datasetApi.records(id, pageSize, (page - 1) * pageSize))
      }
    }
    catch (e: any) { setError(e?.message || '加载记录失败') }
    setRecLoading(false)
  }, [searchQ, page])

  useEffect(() => {
    if (active) {
      loadRecords(active.id)
    }
  }, [active?.id, page, searchQ])

  const handleSearch = () => {
    setPage(1)
    if (active) loadRecords(active.id, true)
  }

  const openDataset = async (d: Dataset) => {
    setActive(d)
    setPage(1)
    setSearchQ('')
    setSelectedIds(new Set())
  }

  const create = async () => {
    setError('')
    try {
      await datasetApi.create({ ...form })
      setMsg('数据集已创建')
      setShowCreate(false)
      setForm({ name: '', description: '', category: 'general' })
      load()
    } catch (e: any) { setError(e?.message || '创建失败') }
  }

  const remove = async (d: Dataset) => {
    if (!confirm(`确认删除数据集「${d.name}」及其全部记录？`)) return
    try {
      await datasetApi.remove(d.id)
      setMsg('已删除')
      if (active?.id === d.id) setActive(null)
      load()
    } catch (e: any) { setError(e?.message || '删除失败') }
  }

  const addRecord = async () => {
    if (!active) return
    setError('')
    try {
      const data = JSON.parse(recJson)
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('需为 JSON 对象')
      await datasetApi.addRecord(active.id, data)
      setMsg('记录已添加')
      setShowAddRec(false)
      setRecJson('{\n  \n}')
      const updated = await datasetApi.get(active.id)
      setActive(updated)
      loadRecords(active.id)
      load()
    } catch (e: any) { setError('JSON 解析失败: ' + (e?.message || e)) }
  }

  const startEdit = (r: DatasetRecord) => {
    setEditingId(r.id)
    setEditData(JSON.stringify(r.data, null, 2))
  }

  const saveEdit = async () => {
    if (!active || editingId === null) return
    setError('')
    try {
      const data = JSON.parse(editData)
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('需为 JSON 对象')
      await datasetApi.updateRecord(active.id, editingId, data)
      setMsg('记录已更新')
      setEditingId(null)
      setEditData('')
      loadRecords(active.id)
    } catch (e: any) { setError('保存失败: ' + (e?.message || e)) }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditData('')
  }

  const removeRecord = async (rid: number) => {
    if (!active) return
    if (!confirm('确认删除此记录？')) return
    try {
      await datasetApi.deleteRecord(active.id, rid)
      setMsg('记录已删除')
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(rid)
        return next
      })
      const updated = await datasetApi.get(active.id)
      setActive(updated)
      loadRecords(active.id)
      load()
    } catch (e: any) { setError(e?.message || '删除失败') }
  }

  const batchDelete = async () => {
    if (!active || selectedIds.size === 0) return
    if (!confirm(`确认删除选中的 ${selectedIds.size} 条记录？`)) return
    try {
      await datasetApi.batchDelete(active.id, Array.from(selectedIds))
      setMsg(`已删除 ${selectedIds.size} 条记录`)
      setSelectedIds(new Set())
      const updated = await datasetApi.get(active.id)
      setActive(updated)
      loadRecords(active.id)
      load()
    } catch (e: any) { setError(e?.message || '批量删除失败') }
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === records.length && records.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(records.map(r => r.id)))
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const doImport = async () => {
    if (!active) return
    setError('')
    try {
      const r = await datasetApi.importRecords(active.id, importFmt, importText)
      setMsg(`导入完成：新增 ${r.inserted} 条，跳过 ${r.skipped} 条`)
      setShowImport(false)
      setImportText('')
      const updated = await datasetApi.get(active.id)
      setActive(updated)
      loadRecords(active.id)
      load()
    } catch (e: any) { setError(e?.message || '导入失败') }
  }

  const doExport = async (fmt: 'json' | 'csv') => {
    if (!active) return
    try {
      const r = await datasetApi.exportRecords(active.id, fmt)
      const blob = new Blob([r.content], { type: fmt === 'json' ? 'application/json' : 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${active.name}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setError(e?.message || '导出失败') }
  }

  const allFields = Array.from(new Set(records.flatMap((r) => Object.keys(r.data))))

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Database className="text-accent" size={24} />
        <h1 className="text-xl font-semibold text-text-primary">数据集</h1>
      </div>
      <p className="text-sm text-text-muted mb-4">数据集分类管理、记录 CRUD、导入(CSV/JSON)与导出，供 RAG 检索使用。</p>

      {error && <div className="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 flex items-center justify-between">
        <span>{error}</span>
        <button onClick={() => setError('')} className="text-red-400 hover:text-red-300"><X size={14} /></button>
      </div>}
      {msg && <div className="mb-3 text-sm text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2" onClick={() => setMsg('')}>{msg}</div>}

      {!active ? (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-sm">
              <Plus size={14} /> 新建数据集
            </button>
          </div>
          {loading ? <div className="text-sm text-text-dim">加载中…</div> :
            datasets.length === 0 ? <div className="text-sm text-text-dim py-8 text-center">暂无数据集。点击「新建数据集」开始。</div> :
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {datasets.map((d) => (
                <div key={d.id} className="bg-bg-secondary border border-border rounded-lg p-4 flex flex-col cursor-pointer hover:border-accent/40 transition-colors"
                  onClick={() => openDataset(d)}>
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-sm font-medium text-text-primary truncate">{d.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-bg-tertiary text-text-muted">{d.category}</span>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2 mb-3 flex-1">{d.description || '（无描述）'}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-dim">{d.record_count} 条记录</span>
                    <button onClick={(e) => { e.stopPropagation(); remove(d) }}
                      className="p-1.5 rounded border border-border text-text-muted hover:text-red-500 dark:hover:text-red-400" title="删除">
                      <Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>}
        </>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button onClick={() => setActive(null)} className="text-sm text-text-muted hover:text-text-primary">← 返回列表</button>
            <span className="text-text-dim">/</span>
            <span className="text-sm text-text-primary">{active.name}</span>
            <span className="text-xs text-text-dim">（{active.record_count} 条记录）</span>
            <div className="flex-1" />
            <button onClick={() => setShowAddRec(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs text-text-secondary hover:text-text-primary">
              <Plus size={12} /> 新增记录
            </button>
            <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs text-text-secondary hover:text-text-primary">
              <Upload size={12} /> 导入
            </button>
            <button onClick={() => doExport('json')} className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs text-text-secondary hover:text-text-primary">
              <FileJson size={12} /> JSON
            </button>
            <button onClick={() => doExport('csv')} className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs text-text-secondary hover:text-text-primary">
              <FileSpreadsheet size={12} /> CSV
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full bg-bg-secondary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary focus:border-accent outline-none"
                placeholder="搜索记录内容…" />
            </div>
            <button onClick={handleSearch} disabled={searching}
              className="px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50">
              {searching ? '搜索中…' : '搜索'}
            </button>
            {selectedIds.size > 0 && (
              <button onClick={batchDelete}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-red-500/40 text-red-500 text-sm hover:bg-red-500/10">
                <Trash2 size={14} /> 删除选中 ({selectedIds.size})
              </button>
            )}
          </div>

          {recLoading ? <div className="text-sm text-text-dim">加载中…</div> :
            records.length === 0 ? <div className="text-sm text-text-dim py-8 text-center">
              {searchQ ? '未找到匹配的记录' : '暂无记录。点击「新增记录」或「导入」。'}
            </div> :
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-text-muted">
                <div className="flex items-center gap-2">
                  <Table2 size={14} />
                  <span>记录列表</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1 rounded hover:bg-bg-tertiary disabled:opacity-30">
                    <ChevronLeft size={14} />
                  </button>
                  <span>第 {page} 页</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={records.length < pageSize}
                    className="p-1 rounded hover:bg-bg-tertiary disabled:opacity-30">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-tertiary text-text-muted">
                    <tr>
                      <th className="text-left px-2 py-2 w-8">
                        <input type="checkbox" checked={records.length > 0 && selectedIds.size === records.length}
                          onChange={toggleSelectAll} className="accent-accent" />
                      </th>
                      <th className="text-left px-3 py-2 font-medium w-16">#</th>
                      {allFields.map((k) => (
                        <th key={k} className="text-left px-3 py-2 font-medium">{k}</th>
                      ))}
                      <th className="text-right px-3 py-2 font-medium w-24">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className={`border-t border-border ${editingId === r.id ? 'bg-accent/5' : 'hover:bg-bg-tertiary'}`}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={selectedIds.has(r.id)}
                            onChange={() => toggleSelect(r.id)} className="accent-accent" />
                        </td>
                        <td className="px-3 py-2 text-text-dim">{r.id}</td>
                        {allFields.map((k) => (
                          <td key={k} className="px-3 py-2 text-text-secondary max-w-[200px]">
                            {editingId === r.id ? (
                              k === allFields[0] ? (
                                <textarea value={editData} onChange={(e) => setEditData(e.target.value)}
                                  className="w-full bg-bg-tertiary border border-accent rounded px-2 py-1 text-xs font-mono h-24"
                                  style={{ gridColumn: `1 / -1` }} />
                              ) : null
                            ) : (
                              <span className="truncate block" title={String(r.data[k] ?? '')}>
                                {String(r.data[k] ?? '')}
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right">
                          {editingId === r.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={saveEdit} className="p-1 text-green-500 hover:text-green-400" title="保存">
                                <Check size={14} />
                              </button>
                              <button onClick={cancelEdit} className="p-1 text-text-muted hover:text-text-secondary" title="取消">
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => startEdit(r)} className="p-1 text-text-muted hover:text-accent" title="编辑">
                                <Edit2 size={12} />
                              </button>
                              <button onClick={() => removeRecord(r.id)} className="p-1 text-text-muted hover:text-red-500 dark:hover:text-red-400" title="删除">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>}
        </div>
      )}

      {/* 新建数据集 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">新建数据集</h3>
              <button onClick={() => setShowCreate(false)} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-text-muted">名称</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
              </div>
              <div>
                <label className="text-xs text-text-muted">分类</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
              </div>
              <div>
                <label className="text-xs text-text-muted">描述</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:border-accent outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={create} disabled={!form.name.trim()}
                className="px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 新增记录 */}
      {showAddRec && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAddRec(false)}>
          <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">新增记录（JSON 对象）</h3>
              <button onClick={() => setShowAddRec(false)} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
            </div>
            <div className="p-5">
              <textarea value={recJson} onChange={(e) => setRecJson(e.target.value)} rows={10}
                className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent outline-none" />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowAddRec(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={addRecord} className="px-3 py-1.5 rounded bg-accent text-white text-sm">添加</button>
            </div>
          </div>
        </div>
      )}

      {/* 导入 */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowImport(false)}>
          <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">导入记录</h3>
              <button onClick={() => setShowImport(false)} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                {(['json', 'csv'] as const).map((f) => (
                  <button key={f} onClick={() => setImportFmt(f)}
                    className={`px-3 py-1.5 rounded text-xs border ${importFmt === f ? 'border-accent text-accent' : 'border-border text-text-muted'}`}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted">
                {importFmt === 'json' ? '粘贴 JSON 数组，每个元素为一条记录（对象）。' : '粘贴 CSV，首行为表头。'}
              </p>
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10}
                className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:border-accent outline-none"
                placeholder={importFmt === 'json' ? '[{"name":"示例","value":1}]' : 'name,value\n示例,1'} />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowImport(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={doImport} className="px-3 py-1.5 rounded bg-accent text-white text-sm">导入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
