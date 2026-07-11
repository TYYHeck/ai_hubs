import { useState, useEffect, useCallback } from 'react'
import { Database, Plus, Trash2, Upload, Download, X, FileJson, FileSpreadsheet, Table2 } from 'lucide-react'
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

  // 新增记录
  const [showAddRec, setShowAddRec] = useState(false)
  const [recJson, setRecJson] = useState('{\n  \n}')
  // 导入
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
  // 监听 AI 触发的资源变更 → 自动刷新数据集列表
  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'datasets') load()
    })
  }, [load])

  const loadRecords = useCallback(async (id: number) => {
    setRecLoading(true)
    try { setRecords(await datasetApi.records(id, 200, 0)) }
    catch (e: any) { setError(e?.message || '加载记录失败') }
    setRecLoading(false)
  }, [])

  const openDataset = async (d: Dataset) => {
    setActive(d)
    await loadRecords(d.id)
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
      // 刷新
      const updated = await datasetApi.get(active.id)
      setActive(updated)
      loadRecords(active.id)
      load()
    } catch (e: any) { setError('JSON 解析失败: ' + (e?.message || e)) }
  }

  const removeRecord = async (rid: number) => {
    if (!active) return
    try {
      await datasetApi.deleteRecord(active.id, rid)
      setMsg('记录已删除')
      const updated = await datasetApi.get(active.id)
      setActive(updated)
      loadRecords(active.id)
      load()
    } catch (e: any) { setError(e?.message || '删除失败') }
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Database className="text-accent" size={24} />
        <h1 className="text-xl font-semibold text-text-primary">数据集</h1>
      </div>
      <p className="text-sm text-text-muted mb-4">数据集分类管理、记录 CRUD、导入(CSV/JSON)与导出，供 RAG 检索使用。</p>

      {error && <div className="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</div>}
      {msg && <div className="mb-3 text-sm text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">{msg}</div>}

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

          {recLoading ? <div className="text-sm text-text-dim">加载中…</div> :
            records.length === 0 ? <div className="text-sm text-text-dim py-8 text-center">暂无记录。点击「新增记录」或「导入」。</div> :
            <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border text-xs text-text-muted">
                <Table2 size={14} /> 记录预览（最多 200 条）
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-tertiary text-text-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      {Array.from(new Set(records.flatMap((r) => Object.keys(r.data)))).map((k) => (
                        <th key={k} className="text-left px-3 py-2 font-medium">{k}</th>
                      ))}
                      <th className="text-right px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-t border-border hover:bg-bg-tertiary">
                        <td className="px-3 py-2 text-text-dim">{r.id}</td>
                        {Array.from(new Set(records.flatMap((x) => Object.keys(x.data)))).map((k) => (
                          <td key={k} className="px-3 py-2 text-text-secondary max-w-[240px] truncate" title={String(r.data[k] ?? '')}>
                            {String(r.data[k] ?? '')}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => removeRecord(r.id)} className="text-text-muted hover:text-red-500 dark:hover:text-red-400" title="删除">
                            <Trash2 size={12} /></button>
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
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-muted">分类</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-muted">描述</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={create} className="px-3 py-1.5 rounded bg-accent text-white text-sm">创建</button>
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
              <textarea value={recJson} onChange={(e) => setRecJson(e.target.value)} rows={8}
                className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono" />
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
                className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono" placeholder={importFmt === 'json' ? '[{"name":"示例","value":1}]' : 'name,value\n示例,1'} />
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
