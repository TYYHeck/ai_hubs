// AI Hubs — 后台管理（仪表盘 + 用户/Agent/技能管理，仅管理员）

import { useCallback, useEffect, useState } from 'react'
import {
  Users, Bot, Package, Database, ListTodo, MessageSquare, Activity,
  Search, Trash2, Pencil, ChevronLeft, ChevronRight, Shield, UserX,
  LayoutDashboard, Copy, RotateCw, Plus, RefreshCw, Zap, BarChart3,
} from 'lucide-react'
import {
  adminApi, type AdminDashboard, type AdminUser, type AdminUserUpdate,
  type AdminAgent, type AdminAgentList,
} from '../api/client'
import type { Skill } from '../api/client'
import { formatNumber } from '../utils/format'

type TabKey = 'dashboard' | 'users' | 'agents' | 'skills'

export default function AdminPage() {
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [dash, setDash] = useState<AdminDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDash = useCallback(async () => {
    try { setDash(await adminApi.dashboard()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { setLoading(true); loadDash().finally(() => setLoading(false)) }, [loadDash])

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
    { key: 'users', label: '用户管理', icon: Users },
    { key: 'agents', label: 'Agent 管理', icon: Bot },
    { key: 'skills', label: '技能管理', icon: Package },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-text-primary mb-1">后台管理</h1>
      <p className="text-sm text-text-muted mb-6">系统概览 · 用户 · Agent · 技能</p>

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 mb-6 p-1 bg-bg-tertiary rounded-xl w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
              tab === t.key
                ? 'bg-accent text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card p-3 mb-4 border-red-500/40 bg-red-500/10 text-red-300 text-sm">{error}</div>
      )}

      {tab === 'dashboard' && <DashboardTab dash={dash} loading={loading} />}
      {tab === 'users' && <UsersTab errorHandler={setError} />}
      {tab === 'agents' && <AgentsTab errorHandler={setError} />}
      {tab === 'skills' && <SkillsTab errorHandler={setError} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 仪表盘 Tab
// ═══════════════════════════════════════════════════════════════

function DashboardTab({ dash, loading }: { dash: AdminDashboard | null; loading: boolean }) {
  if (loading || !dash) {
    return <div className="card p-12 text-center text-text-muted text-sm">加载中…</div>
  }

  const statCards = [
    { label: '用户总数', value: dash.users.total, icon: Users, color: 'text-blue-600 dark:text-blue-400' },
    { label: '活跃用户', value: dash.users.active, icon: Activity, color: 'text-green-600 dark:text-green-400' },
    { label: '管理员', value: dash.users.admins, icon: Shield, color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Agent', value: dash.agents.total, icon: Bot, color: 'text-purple-600 dark:text-purple-400' },
    { label: '技能', value: dash.skills.total, icon: Package, color: 'text-orange-600 dark:text-orange-400' },
    { label: '数据集', value: dash.datasets.total, icon: Database, color: 'text-cyan-600 dark:text-cyan-400' },
    { label: '任务', value: dash.tasks.total, icon: ListTodo, color: 'text-pink-400' },
    { label: '对话 / 消息', value: `${dash.conversations.total} / ${dash.messages.total}`, icon: MessageSquare, color: 'text-teal-400' },
  ]

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="card p-4">
            <s.icon size={18} className={s.color} />
            <div className="text-2xl font-bold text-text-primary mt-2">{s.value}</div>
            <div className="text-xs text-text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {Object.keys(dash.skills.by_source).length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-medium text-text-primary mb-3">技能来源分布</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(dash.skills.by_source).map(([src, cnt]) => (
              <span key={src} className="px-3 py-1 rounded-full bg-bg-tertiary text-xs text-text-secondary">
                {src}: {cnt}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// 用户管理 Tab（含配额列）
// ═══════════════════════════════════════════════════════════════

function UsersTab({ errorHandler }: { errorHandler: (e: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editForm, setEditForm] = useState<AdminUserUpdate>({})
  const [saving, setSaving] = useState(false)

  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const pageSize = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const u = await adminApi.listUsers({ page, page_size: pageSize, search })
      setUsers(u.items)
      setTotal(u.total)
    } catch (e: any) {
      errorHandler(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, search, errorHandler])

  useEffect(() => { load() }, [load])

  const openEdit = (u: AdminUser) => {
    setEditUser(u)
    // 过滤掉 null/undefined 值，避免发送无效数据到后端
    const form: AdminUserUpdate = {}
    if (u.email != null) form.email = u.email
    if (u.role) form.role = u.role as 'admin' | 'user'
    if (u.is_active != null) form.is_active = u.is_active
    if (u.token_quota != null) form.token_quota = u.token_quota
    setEditForm(form)
  }

  const saveEdit = async () => {
    if (!editUser) return
    setSaving(true)
    try {
      const updated = await adminApi.updateUser(editUser.id, editForm)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      setEditUser(null)
      setEditForm({})
    } catch (e: any) {
      errorHandler(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteUser) return
    setDeleting(true)
    try {
      await adminApi.deleteUser(deleteUser.id)
      setUsers((prev) => prev.filter((u) => u.id !== deleteUser.id))
      setTotal((t) => t - 1)
      setDeleteUser(null)
    } catch (e: any) {
      errorHandler(e?.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const resetUsage = async (u: AdminUser) => {
    try {
      const updated = await adminApi.resetUserUsage(u.id)
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e: any) {
      errorHandler(e?.message || '重置失败')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-text-primary">用户管理（{total}）</h2>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-text-muted" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="搜索用户名/邮箱"
            className="bg-bg-tertiary border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-text-primary w-56 focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted border-b border-border">
              <th className="py-2 px-2 font-medium">ID</th>
              <th className="py-2 px-2 font-medium">用户名</th>
              <th className="py-2 px-2 font-medium">邮箱</th>
              <th className="py-2 px-2 font-medium">角色</th>
              <th className="py-2 px-2 font-medium">状态</th>
              <th className="py-2 px-2 font-medium">Token 用量</th>
              <th className="py-2 px-2 font-medium">注册时间</th>
              <th className="py-2 px-2 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const quota = u.token_quota
              const used = u.token_used
              const pct = quota && quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
              return (
                <tr key={u.id} className="border-b border-border/50 hover:bg-bg-tertiary/40">
                  <td className="py-2 px-2 text-text-muted">{u.id}</td>
                  <td className="py-2 px-2 text-text-primary">{u.username}</td>
                  <td className="py-2 px-2 text-text-muted max-w-[140px] truncate" title={u.email}>{u.email || '—'}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      u.role === 'admin' ? 'bg-amber-500/15 text-amber-300' : 'bg-bg-tertiary text-text-muted'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      u.is_active ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
                    }`}>
                      {u.is_active ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-[80px]">
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="text-text-secondary">{formatNumber(used)}</span>
                          <span className="text-text-dim">
                            / {quota === 0 ? '不限' : quota == null ? formatNumber(10000) : formatNumber(quota)}
                          </span>
                        </div>
                        {quota && quota > 0 && (
                          <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-amber-400' : 'bg-green-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => resetUsage(u)}
                        className="text-text-muted hover:text-accent p-1 rounded transition-colors"
                        title="重置用量"
                      >
                        <RotateCw size={12} />
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-text-muted text-xs">{u.created_at?.slice(0, 10) || '—'}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(u)} className="text-text-muted hover:text-accent p-1.5 rounded" title="编辑">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setDeleteUser(u)} className="text-text-muted hover:text-red-500 dark:hover:text-red-400 p-1.5 rounded" title="删除">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && !loading && (
              <tr><td colSpan={8} className="py-8 text-center text-text-muted text-sm">无用户</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-text-muted">第 {page} / {totalPages} 页</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded bg-bg-tertiary text-text-secondary disabled:opacity-30 hover:bg-bg-tertiary/70">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded bg-bg-tertiary text-text-secondary disabled:opacity-30 hover:bg-bg-tertiary/70">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editUser && (
        <Modal onClose={() => { setEditUser(null); setEditForm({}) }}>
          <h3 className="text-base font-medium text-text-primary mb-4">编辑用户：{editUser.username}</h3>
          <div className="space-y-4">
            <Field label="邮箱">
              <input value={editForm.email ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                className="input" />
            </Field>
            <Field label="角色">
              <select value={editForm.role ?? 'user'} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as 'admin' | 'user' }))}
                className="input">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </Field>
            <Field label="Token 配额（0=不限）">
              <input type="number" min={0} value={editForm.token_quota ?? 10000}
                onChange={(e) => setEditForm((f) => ({ ...f, token_quota: parseInt(e.target.value) || 0 }))}
                className="input" />
            </Field>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={editForm.is_active ?? false}
                onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="accent-accent" />
              <label htmlFor="is_active" className="text-sm text-text-secondary">账号启用</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => { setEditUser(null); setEditForm({}) }}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary">取消</button>
            <button onClick={saveEdit} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 删除确认 */}
      {deleteUser && (
        <Modal onClose={() => setDeleteUser(null)} small>
          <div className="flex items-center gap-2 mb-3">
            <UserX size={18} className="text-red-500 dark:text-red-400" />
            <h3 className="text-base font-medium text-text-primary">删除用户</h3>
          </div>
          <p className="text-sm text-text-muted mb-6">
            确定删除用户 <span className="text-text-primary">{deleteUser.username}</span> 吗？此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteUser(null)}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary">取消</button>
            <button onClick={confirmDelete} disabled={deleting}
              className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">
              {deleting ? '删除中…' : '删除'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Agent 管理 Tab
// ═══════════════════════════════════════════════════════════════

function AgentsTab({ errorHandler }: { errorHandler: (e: string) => void }) {
  const [items, setItems] = useState<AdminAgent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // 复制弹窗
  const [copyTarget, setCopyTarget] = useState<AdminAgent | null>(null)
  const [copyUserId, setCopyUserId] = useState('')
  const [copyName, setCopyName] = useState('')
  const [copying, setCopying] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminAgent | null>(null)

  const pageSize = 15

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.listAgents({ page, page_size: pageSize, search })
      setItems(res.items)
      setTotal(res.total)
    } catch (e: any) {
      errorHandler(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, search, errorHandler])

  useEffect(() => { load() }, [load])

  const doCopy = async () => {
    if (!copyTarget || !copyUserId) return
    setCopying(true)
    try {
      await adminApi.copyAgent(copyTarget.id, parseInt(copyUserId), copyName || undefined)
      setCopyTarget(null)
      setCopyUserId('')
      setCopyName('')
      errorHandler('') // 清除错误
    } catch (e: any) {
      errorHandler(e?.message || '复制失败')
    } finally {
      setCopying(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await adminApi.deleteAgent(deleteTarget.id)
      setItems((prev) => prev.filter((a) => a.id !== deleteTarget.id))
      setTotal((t) => t - 1)
      setDeleteTarget(null)
    } catch (e: any) {
      errorHandler(e?.message || '删除失败')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-text-primary">Agent 管理（{total}）</h2>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-text-muted" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="搜索 Agent 名称/描述" className="admin-search-input" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted border-b border-border">
              <th className="py-2 px-2 font-medium">名称</th>
              <th className="py-2 px-2 font-medium">所有者</th>
              <th className="py-2 px-2 font-medium">模型</th>
              <th className="py-2 px-2 font-medium">分类</th>
              <th className="py-2 px-2 font-medium">默认</th>
              <th className="py-2 px-2 font-medium">状态</th>
              <th className="py-2 px-2 font-medium">创建时间</th>
              <th className="py-2 px-2 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-border/50 hover:bg-bg-tertiary/40">
                <td className="py-2 px-2">
                  <div className="text-text-primary font-medium">{a.name}</div>
                  <div className="text-text-muted text-xs truncate max-w-[180px]">{a.description || '—'}</div>
                </td>
                <td className="py-2 px-2 text-text-muted">{a.owner_username}</td>
                <td className="py-2 px-2 text-text-muted text-xs">{a.model}</td>
                <td className="py-2 px-2">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-bg-tertiary text-text-muted">{a.category}</span>
                </td>
                <td className="py-2 px-2">
                  {a.is_default ? <span className="text-green-600 dark:text-green-400 text-xs">✓ 默认</span> : <span className="text-text-dim">—</span>}
                </td>
                <td className="py-2 px-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    a.status === 'active' ? 'bg-green-500/15 text-green-300' : 'bg-bg-tertiary text-text-muted'
                  }`}>{a.status}</span>
                </td>
                <td className="py-2 px-2 text-text-muted text-xs">{a.created_at?.slice(0, 10) || '—'}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">
                  <button onClick={() => { setCopyTarget(a); setCopyName(a.name) }}
                    className="text-text-muted hover:text-accent p-1.5 rounded" title="复制到其他用户">
                    <Copy size={14} />
                  </button>
                  <button onClick={() => setDeleteTarget(a)}
                    className="text-text-muted hover:text-red-500 dark:hover:text-red-400 p-1.5 rounded" title="删除">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={8} className="py-8 text-center text-text-muted text-sm">无 Agent</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      )}

      {/* 复制弹窗 */}
      {copyTarget && (
        <Modal onClose={() => { setCopyTarget(null); setCopyUserId(''); setCopyName('') }}>
          <h3 className="text-base font-medium text-text-primary mb-4">复制 Agent：{copyTarget.name}</h3>
          <div className="space-y-4">
            <Field label="目标用户 ID">
              <input type="number" min={1} value={copyUserId}
                onChange={(e) => setCopyUserId(e.target.value)}
                placeholder="输入目标用户的 ID" className="input" />
            </Field>
            <Field label="新名称（留空保留原名）">
              <input value={copyName} onChange={(e) => setCopyName(e.target.value)}
                placeholder={copyTarget.name} className="input" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => { setCopyTarget(null); setCopyUserId(''); setCopyName('') }}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary">取消</button>
            <button onClick={doCopy} disabled={copying || !copyUserId}
              className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
              {copying ? '复制中…' : '复制'}
            </button>
          </div>
        </Modal>
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)} small>
          <div className="flex items-center gap-2 mb-3">
            <UserX size={18} className="text-red-500 dark:text-red-400" />
            <h3 className="text-base font-medium text-text-primary">删除 Agent</h3>
          </div>
          <p className="text-sm text-text-muted mb-6">
            确定删除 Agent <span className="text-text-primary">{deleteTarget.name}</span>（所有者: {deleteTarget.owner_username}）吗？
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary">取消</button>
            <button onClick={doDelete}
              className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600">删除</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 技能管理 Tab
// ═══════════════════════════════════════════════════════════════

function SkillsTab({ errorHandler }: { errorHandler: (e: string) => void }) {
  const [items, setItems] = useState<Skill[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(true)

  // 新建/编辑弹窗
  const [editSkill, setEditSkill] = useState<Partial<Skill> & { name?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)
  const [syncing, setSyncing] = useState(false)

  const pageSize = 15

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.listSkills({ page, page_size: pageSize, search, source: source || undefined })
      setItems(res.items)
      setTotal(res.total)
    } catch (e: any) {
      errorHandler(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, search, source, errorHandler])

  useEffect(() => { load() }, [load])

  const doSave = async () => {
    if (!editSkill?.name) return
    const name = editSkill.name
    setSaving(true)
    try {
      if (editSkill.id) {
        const updated = await adminApi.updateSkill(editSkill.id, editSkill as Partial<Skill>)
        setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      } else {
        const created = await adminApi.createSkill({ ...editSkill, name } as any)
        setItems((prev) => [created, ...prev])
        setTotal((t) => t + 1)
      }
      setEditSkill(null)
    } catch (e: any) {
      errorHandler(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await adminApi.deleteSkill(deleteTarget.id)
      setItems((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      setTotal((t) => t - 1)
      setDeleteTarget(null)
    } catch (e: any) {
      errorHandler(e?.message || '删除失败')
    }
  }

  const doSync = async (s: Skill) => {
    try {
      const updated = await adminApi.syncSkill(s.id)
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e: any) {
      errorHandler(e?.message || '同步失败')
    }
  }

  const doBatchSync = async () => {
    setSyncing(true)
    try {
      const res = await adminApi.batchSyncSkills()
      errorHandler('')
      alert(`已同步 ${res.synced}/${res.total} 个内置技能`)
      load()
    } catch (e: any) {
      errorHandler(e?.message || '批量同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const openNew = () => {
    setEditSkill({ name: '', description: '', category: 'custom', source: 'custom', config: {}, is_installed: true })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // 来源筛选选项
  const srcOptions = ['', 'builtin', 'github', 'custom']
  const srcLabels: Record<string, string> = { '': '全部来源', builtin: '内置', github: 'GitHub', custom: '自定义' }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-text-primary">技能管理（{total}）</h2>
        <div className="flex items-center gap-2">
          <button onClick={doBatchSync} disabled={syncing}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-bg-tertiary text-text-secondary hover:text-text-primary disabled:opacity-50">
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            批量同步
          </button>
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1) }}
            className="bg-bg-tertiary border border-border rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-accent">
            {srcOptions.map((s) => <option key={s} value={s}>{srcLabels[s]}</option>)}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-text-muted" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="搜索技能" className="admin-search-input pl-8" />
          </div>
          <button onClick={openNew}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-accent text-white hover:opacity-90">
            <Plus size={12} />新建
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted border-b border-border">
              <th className="py-2 px-2 font-medium">名称</th>
              <th className="py-2 px-2 font-medium">分类</th>
              <th className="py-2 px-2 font-medium">来源</th>
              <th className="py-2 px-2 font-medium">版本</th>
              <th className="py-2 px-2 font-medium">已安装</th>
              <th className="py-2 px-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-bg-tertiary/40">
                <td className="py-2 px-2">
                  <div className="text-text-primary font-medium">{s.name}</div>
                  <div className="text-text-muted text-xs truncate max-w-[220px]">{s.description || '—'}</div>
                </td>
                <td className="py-2 px-2">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-bg-tertiary text-text-muted">{s.category}</span>
                </td>
                <td className="py-2 px-2">
                  <SourceBadge source={s.source} />
                </td>
                <td className="py-2 px-2 text-text-muted text-xs">{s.version}</td>
                <td className="py-2 px-2">
                  {s.is_installed
                    ? <span className="text-green-600 dark:text-green-400 text-xs">✓ 已安装</span>
                    : <span className="text-text-dim text-xs">—</span>}
                </td>
                <td className="py-2 px-2 whitespace-nowrap">
                  <button onClick={() => setEditSkill({ ...s })}
                    className="text-text-muted hover:text-accent p-1.5 rounded" title="编辑">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => doSync(s)}
                    className="text-text-muted hover:text-blue-500 dark:hover:text-blue-400 p-1.5 rounded" title="同步">
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => setDeleteTarget(s)}
                    className="text-text-muted hover:text-red-500 dark:hover:text-red-400 p-1.5 rounded" title="删除">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={6} className="py-8 text-center text-text-muted text-sm">无技能</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      )}

      {/* 编辑弹窗 */}
      {editSkill && (
        <Modal onClose={() => setEditSkill(null)}>
          <h3 className="text-base font-medium text-text-primary mb-4">
            {editSkill.id ? `编辑技能：${editSkill.name}` : '新建技能'}
          </h3>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <Field label="名称">
              <input value={editSkill.name ?? ''} onChange={(e) => setEditSkill((f) => ({ ...f, name: e.target.value }))}
                className="input" />
            </Field>
            <Field label="描述">
              <textarea value={editSkill.description ?? ''} onChange={(e) => setEditSkill((f) => ({ ...f, description: e.target.value }))}
                className="input min-h-[60px]" rows={3} />
            </Field>
            <Field label="分类">
              <input value={editSkill.category ?? ''} onChange={(e) => setEditSkill((f) => ({ ...f, category: e.target.value }))}
                className="input" />
            </Field>
            <Field label="来源">
              <select value={editSkill.source ?? 'custom'} onChange={(e) => setEditSkill((f) => ({ ...f, source: e.target.value as Skill['source'] }))}
                className="input">
                <option value="builtin">builtin</option>
                <option value="github">github</option>
                <option value="custom">custom</option>
              </select>
            </Field>
            <Field label="版本">
              <input value={editSkill.version ?? ''} onChange={(e) => setEditSkill((f) => ({ ...f, version: e.target.value }))}
                className="input" />
            </Field>
            <Field label="GitHub URL">
              <input value={(editSkill as any).github_url ?? ''} onChange={(e) => setEditSkill((f) => ({ ...f, github_url: e.target.value }))}
                className="input" placeholder="https://github.com/..." />
            </Field>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="skill_installed" checked={editSkill.is_installed ?? false}
                onChange={(e) => setEditSkill((f) => ({ ...f, is_installed: e.target.checked }))}
                className="accent-accent" />
              <label htmlFor="skill_installed" className="text-sm text-text-secondary">已安装</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setEditSkill(null)}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary">取消</button>
            <button onClick={doSave} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)} small>
          <div className="flex items-center gap-2 mb-3">
            <UserX size={18} className="text-red-500 dark:text-red-400" />
            <h3 className="text-base font-medium text-text-primary">删除技能</h3>
          </div>
          <p className="text-sm text-text-muted mb-6">
            确定删除技能 <span className="text-text-primary">{deleteTarget.name}</span> 吗？
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-tertiary">取消</button>
            <button onClick={doDelete}
              className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600">删除</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 通用子组件
// ═══════════════════════════════════════════════════════════════

function Modal({ children, onClose, small }: { children: React.ReactNode; onClose: () => void; small?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`card p-6 w-full ${small ? 'max-w-sm' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between mt-4 text-sm">
      <span className="text-text-muted">第 {page} / {totalPages} 页</span>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}
          className="p-1.5 rounded bg-bg-tertiary text-text-secondary disabled:opacity-30 hover:bg-bg-tertiary/70">
          <ChevronLeft size={16} />
        </button>
        <button disabled={page >= totalPages} onClick={() => onPage(Math.min(totalPages, page + 1))}
          className="p-1.5 rounded bg-bg-tertiary text-text-secondary disabled:opacity-30 hover:bg-bg-tertiary/70">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    builtin: { label: '内置', cls: 'bg-blue-500/15 text-blue-300' },
    github: { label: 'GitHub', cls: 'bg-purple-500/15 text-purple-300' },
    custom: { label: '自定义', cls: 'bg-amber-500/15 text-amber-300' },
  }
  const s = map[source] ?? { label: source, cls: 'bg-bg-tertiary text-text-muted' }
  return <span className={`px-2 py-0.5 rounded-full text-xs ${s.cls}`}>{s.label}</span>
}
