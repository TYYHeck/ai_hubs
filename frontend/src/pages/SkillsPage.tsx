import { useState, useEffect, useCallback } from 'react'
import { Package, Github, Plus, Search, Download, Trash2, Edit3, Check, X, Code2 } from 'lucide-react'
import { skillApi, type Skill, type GithubSkill } from '../api/client'
import { onAIMutation } from '../stores/chatStore'

const SOURCE_LABEL: Record<string, string> = {
  builtin: '内置',
  github: 'GitHub',
  custom: '自定义',
}
const SOURCE_COLOR: Record<string, string> = {
  builtin: 'text-sky-400 bg-sky-500/10',
  github: 'text-purple-400 bg-purple-500/10',
  custom: 'text-emerald-400 bg-emerald-500/10',
}

export default function SkillsPage() {
  const [tab, setTab] = useState<'mine' | 'market'>('mine')
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  // 模态框（创建/编辑）
  const [editing, setEditing] = useState<Skill | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', category: 'general', entry: 'skill.py', code: '' })

  // GitHub 市场
  const [ghQuery, setGhQuery] = useState('ai agent skill')
  const [ghItems, setGhItems] = useState<GithubSkill[]>([])
  const [ghTotal, setGhTotal] = useState(0)
  const [ghError, setGhError] = useState('')
  const [ghLoading, setGhLoading] = useState(false)
  // 正在安装的仓库 full_name 集合，防止连续点击重复安装产生多条相同技能
  const [installingFns, setInstallingFns] = useState<Set<string>>(new Set())

  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = {}
      if (sourceFilter) params.source = sourceFilter
      if (search.trim()) params.search = search.trim()
      setSkills(await skillApi.list(params))
    } catch (e: any) {
      setError(e?.message || '加载失败')
    }
    setLoading(false)
  }, [sourceFilter, search])

  useEffect(() => {
    if (tab === 'mine') loadSkills()
  }, [tab, loadSkills])

  // 监听 AI 触发的资源变更 → 自动刷新技能列表
  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'skills' && tab === 'mine') loadSkills()
    })
  }, [tab, loadSkills])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', description: '', category: 'general', entry: 'skill.py', code: '' })
    setShowModal(true)
  }
  const openEdit = (s: Skill) => {
    setEditing(s)
    setForm({ name: s.name, description: s.description, category: s.category, entry: (s.config as any)?.entry || 'skill.py', code: (s.config as any)?.code || '' })
    setShowModal(true)
  }

  const saveForm = async () => {
    setError('')
    // 防重复：新建时本地比对同名技能
    if (!editing && skills.some(s => s.name.toLowerCase() === form.name.trim().toLowerCase())) {
      setError(`已存在名为「${form.name.trim()}」的技能，请勿重复创建`)
      return
    }
    try {
      if (editing) {
        await skillApi.update(editing.id, { ...form, code: form.code })
        setMsg('技能已更新')
      } else {
        await skillApi.create({ ...form, code: form.code })
        setMsg('技能已创建')
      }
      setShowModal(false)
      loadSkills()
    } catch (e: any) {
      setError(e?.message || '保存失败')
    }
  }

  const remove = async (s: Skill) => {
    if (!confirm(`确认删除技能「${s.name}」？`)) return
    try {
      await skillApi.remove(s.id)
      setMsg('已删除')
      loadSkills()
    } catch (e: any) { setError(e?.message || '删除失败') }
  }
  const toggleInstall = async (s: Skill) => {
    try {
      if (s.is_installed) await skillApi.uninstall(s.id)
      else await skillApi.install(s.id)
      loadSkills()
    } catch (e: any) { setError(e?.message || '操作失败') }
  }

  const searchMarket = async () => {
    setGhLoading(true)
    setGhError('')
    try {
      const r = await skillApi.marketGithub(ghQuery, 1)
      setGhItems(r.items)
      setGhTotal(r.total)
      if (r.error) setGhError(r.error)
    } catch (e: any) {
      setGhError(e?.message || '检索失败')
    }
    setGhLoading(false)
  }
  useEffect(() => { if (tab === 'market') searchMarket() }, [tab]) // eslint-disable-line

  const installFromGithub = async (g: GithubSkill) => {
    if (installingFns.has(g.full_name)) return  // 防连点：本次安装进行中直接忽略
    setInstallingFns(prev => new Set(prev).add(g.full_name))
    setError('')
    try {
      await skillApi.marketInstall({ full_name: g.full_name, html_url: g.html_url, description: g.description, branch: g.default_branch })
      setMsg(`已安装 ${g.name}`)
    } catch (e: any) { setError(e?.message || '安装失败') }
    finally {
      setInstallingFns(prev => { const n = new Set(prev); n.delete(g.full_name); return n })
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Package className="text-accent" size={24} />
        <h1 className="text-xl font-semibold text-text-primary">技能市场</h1>
      </div>
      <p className="text-sm text-text-muted mb-4">检索 GitHub 技能、一键安装、分类管理与自建技能。</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {([['mine', '我的技能'], ['market', 'GitHub 市场']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${tab === k ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</div>}
      {msg && <div className="mb-3 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">{msg}</div>}

      {tab === 'mine' && (
        <>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2 bg-bg-tertiary border border-border rounded px-3 py-1.5 flex-1 min-w-[220px]">
              <Search size={14} className="text-text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索技能名/描述"
                className="bg-transparent outline-none text-sm text-text-primary flex-1" />
            </div>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-secondary">
              <option value="">全部来源</option>
              <option value="builtin">内置</option>
              <option value="github">GitHub</option>
              <option value="custom">自定义</option>
            </select>
            <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-sm">
              <Plus size={14} /> 新建技能
            </button>
          </div>

          {loading ? <div className="text-sm text-text-dim">加载中…</div> :
            skills.length === 0 ? <div className="text-sm text-text-dim py-8 text-center">暂无技能。点击「新建技能」创建，或从 GitHub 市场安装。</div> :
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {skills.map((s) => (
                <div key={s.id} className="bg-bg-secondary border border-border rounded-lg p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Code2 size={16} className="text-accent flex-shrink-0" />
                      <span className="text-sm font-medium text-text-primary truncate">{s.name}</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${SOURCE_COLOR[s.source] || 'text-text-muted'}`}>{SOURCE_LABEL[s.source]}</span>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2 mb-3 flex-1">{s.description || '（无描述）'}</p>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => toggleInstall(s)}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${s.is_installed ? 'border-green-500/40 text-green-400' : 'border-border text-text-muted hover:text-text-primary'}`}>
                      {s.is_installed ? <><Check size={12} /> 已安装</> : <><Download size={12} /> 安装</>}
                    </button>
                    {s.source === 'custom' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(s)} className="p-1.5 rounded border border-border text-text-muted hover:text-text-primary" title="编辑">
                          <Edit3 size={12} /></button>
                        <button onClick={() => remove(s)} className="p-1.5 rounded border border-border text-text-muted hover:text-red-400" title="删除">
                          <Trash2 size={12} /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>}
        </>
      )}

      {tab === 'market' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-2 bg-bg-tertiary border border-border rounded px-3 py-1.5 flex-1">
              <Github size={14} className="text-text-muted" />
              <input value={ghQuery} onChange={(e) => setGhQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchMarket()}
                placeholder="搜索 GitHub 仓库（如 ai agent, langchain tool）"
                className="bg-transparent outline-none text-sm text-text-primary flex-1" />
            </div>
            <button onClick={searchMarket} className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-sm">
              <Search size={14} /> 检索
            </button>
          </div>
          {ghError && <div className="mb-3 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">{ghError}（可直接创建本地技能）</div>}
          {ghLoading ? <div className="text-sm text-text-dim">检索中…</div> :
            ghItems.length === 0 ? <div className="text-sm text-text-dim py-8 text-center">暂无结果。尝试更换关键词。</div> :
            <>
              <div className="text-xs text-text-dim mb-2">共 {ghTotal} 个仓库</div>
              <div className="space-y-2">
                {ghItems.map((g) => (
                  <div key={g.full_name} className="bg-bg-secondary border border-border rounded-lg p-3 flex items-center gap-3">
                    <Github size={18} className="text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{g.full_name}</div>
                      <div className="text-xs text-text-muted truncate">{g.description}</div>
                      <div className="text-[10px] text-text-dim mt-0.5">★ {g.stars} · {g.language || '—'}</div>
                    </div>
                    <button onClick={() => installFromGithub(g)} disabled={installingFns.has(g.full_name)}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${installingFns.has(g.full_name) ? 'border-border text-text-dim cursor-not-allowed' : 'border-accent/40 text-accent hover:bg-accent/10'}`}>
                      {installingFns.has(g.full_name) ? '安装中…' : <><Download size={12} /> 安装</>}
                    </button>
                  </div>
                ))}
              </div>
            </>}
        </>
      )}

      {/* 创建/编辑模态框 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-text-primary">{editing ? '编辑技能' : '新建技能'}</h3>
              <button onClick={() => setShowModal(false)} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
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
              </div>
              <div>
                <label className="text-xs text-text-muted">描述</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-muted">入口文件名</label>
                <input value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-muted">技能代码</label>
                <textarea value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} rows={10}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono" placeholder="在此编写技能实现代码…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={() => setShowModal(false)} className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary">取消</button>
              <button onClick={saveForm} className="px-3 py-1.5 rounded bg-accent text-white text-sm">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
