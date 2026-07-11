// AI Hubs — 后台管理（仪表盘 + 用户管理，仅管理员）

import { useCallback, useEffect, useState } from 'react'
import {
  Users, Bot, Package, Database, ListTodo, MessageSquare, Activity,
  Search, Trash2, Pencil, ChevronLeft, ChevronRight, Shield, UserX,
} from 'lucide-react'
import { adminApi, type AdminDashboard, type AdminUser, type AdminUserUpdate } from '../api/client'

export default function AdminPage() {
  const [dash, setDash] = useState<AdminDashboard | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 编辑弹窗
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editForm, setEditForm] = useState<AdminUserUpdate>({})
  const [saving, setSaving] = useState(false)

  // 删除确认
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const pageSize = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [d, u] = await Promise.all([
        adminApi.dashboard(),
        adminApi.listUsers({ page, page_size: pageSize, search }),
      ])
      setDash(d)
      setUsers(u.items)
      setTotal(u.total)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { loadData() }, [loadData])

  const openEdit = (u: AdminUser) => {
    setEditUser(u)
    setEditForm({ email: u.email, role: u.role as 'admin' | 'user', is_active: u.is_active })
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
      setError(e?.message || '保存失败')
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
      setError(e?.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const statCards = dash ? [
    { label: '用户总数', value: dash.users.total, icon: Users, color: 'text-blue-400' },
    { label: '活跃用户', value: dash.users.active, icon: Activity, color: 'text-green-400' },
    { label: '管理员', value: dash.users.admins, icon: Shield, color: 'text-amber-400' },
    { label: 'Agent', value: dash.agents.total, icon: Bot, color: 'text-purple-400' },
    { label: '技能', value: dash.skills.total, icon: Package, color: 'text-orange-400' },
    { label: '数据集', value: dash.datasets.total, icon: Database, color: 'text-cyan-400' },
    { label: '任务', value: dash.tasks.total, icon: ListTodo, color: 'text-pink-400' },
    { label: '对话 / 消息', value: `${dash.conversations.total} / ${dash.messages.total}`, icon: MessageSquare, color: 'text-teal-400' },
  ] : []

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-100 mb-1">后台管理</h1>
      <p className="text-sm text-neutral-500 mb-6">系统概览与用户管理</p>

      {error && (
        <div className="card p-3 mb-4 border-red-500/40 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* 仪表盘统计 */}
      {loading && !dash ? (
        <div className="card p-12 text-center text-neutral-500 text-sm">加载中…</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {statCards.map((s) => (
            <div key={s.label} className="card p-4">
              <s.icon size={18} className={s.color} />
              <div className="text-2xl font-bold text-neutral-100 mt-2">{s.value}</div>
              <div className="text-xs text-neutral-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 技能来源分布 */}
      {dash && Object.keys(dash.skills.by_source).length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-medium text-neutral-200 mb-3">技能来源分布</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(dash.skills.by_source).map(([src, cnt]) => (
              <span key={src} className="px-3 py-1 rounded-full bg-bg-tertiary text-xs text-neutral-300">
                {src}: {cnt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 用户管理 */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-200">用户管理（{total}）</h2>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-500" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="搜索用户名/邮箱"
              className="bg-bg-tertiary border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-neutral-200 w-56 focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-border">
                <th className="py-2 px-2 font-medium">ID</th>
                <th className="py-2 px-2 font-medium">用户名</th>
                <th className="py-2 px-2 font-medium">邮箱</th>
                <th className="py-2 px-2 font-medium">角色</th>
                <th className="py-2 px-2 font-medium">状态</th>
                <th className="py-2 px-2 font-medium">注册时间</th>
                <th className="py-2 px-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/50 hover:bg-bg-tertiary/40">
                  <td className="py-2 px-2 text-neutral-500">{u.id}</td>
                  <td className="py-2 px-2 text-neutral-200">{u.username}</td>
                  <td className="py-2 px-2 text-neutral-400">{u.email || '—'}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      u.role === 'admin' ? 'bg-amber-500/15 text-amber-300' : 'bg-bg-tertiary text-neutral-400'
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
                  <td className="py-2 px-2 text-neutral-500">{u.created_at?.slice(0, 10) || '—'}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(u)}
                      className="text-neutral-400 hover:text-accent p-1.5 rounded transition-colors"
                      title="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteUser(u)}
                      className="text-neutral-400 hover:text-red-400 p-1.5 rounded transition-colors"
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-neutral-500 text-sm">无用户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-neutral-500">第 {page} / {totalPages} 页</span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded bg-bg-tertiary text-neutral-300 disabled:opacity-30 hover:bg-bg-tertiary/70"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded bg-bg-tertiary text-neutral-300 disabled:opacity-30 hover:bg-bg-tertiary/70"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md">
            <h3 className="text-base font-medium text-neutral-100 mb-4">
              编辑用户：{editUser.username}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-neutral-500">邮箱</label>
                <input
                  value={editForm.email ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500">角色</label>
                <select
                  value={editForm.role ?? 'user'}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as 'admin' | 'user' }))}
                  className="w-full mt-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-accent"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={editForm.is_active ?? false}
                  onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="accent-accent"
                />
                <label htmlFor="is_active" className="text-sm text-neutral-300">账号启用</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => { setEditUser(null); setEditForm({}) }}
                className="px-4 py-2 rounded-lg text-sm text-neutral-300 hover:bg-bg-tertiary"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {deleteUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-3">
              <UserX size={18} className="text-red-400" />
              <h3 className="text-base font-medium text-neutral-100">删除用户</h3>
            </div>
            <p className="text-sm text-neutral-400 mb-6">
              确定删除用户 <span className="text-neutral-200">{deleteUser.username}</span> 吗？此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteUser(null)}
                className="px-4 py-2 rounded-lg text-sm text-neutral-300 hover:bg-bg-tertiary"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
