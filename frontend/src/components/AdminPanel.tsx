import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { adminApi } from '../api/client';
import type { AdminUser, AdminStats } from '../types';

export default function AdminPanel() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', email: '', role: 'user' });
  const [editUser, setEditUser] = useState<AdminUser | null>(null);

  const isAdmin = (currentUser as { role?: string } | null)?.role === 'admin';

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([adminApi.stats(), adminApi.listUsers()]);
      if (s.ok) setStats(s.stats);
      if (u.ok) setUsers(u.users);
    } catch {
      showMsg('error', '加载后台数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.username.trim() || form.password.length < 8) {
      showMsg('error', '用户名必填，密码至少 8 位');
      return;
    }
    try {
      const res = await adminApi.createUser(form.username.trim(), form.password, form.email.trim(), form.role);
      if (res.ok) {
        showMsg('success', `用户 ${form.username} 创建成功`);
        setForm({ username: '', password: '', email: '', role: 'user' });
        setShowCreate(false);
        load();
      } else {
        showMsg('error', '创建失败');
      }
    } catch (e) {
      showMsg('error', `创建失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    try {
      await adminApi.updateUser(u.username, { is_active: !u.is_active });
      showMsg('success', `已${u.is_active ? '禁用' : '启用'} ${u.username}`);
      load();
    } catch (e) {
      showMsg('error', `操作失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  const handleRole = async (u: AdminUser, role: string) => {
    try {
      await adminApi.updateUser(u.username, { role });
      showMsg('success', `${u.username} 角色已更新为 ${role}`);
      load();
    } catch (e) {
      showMsg('error', `操作失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`确定删除用户 ${u.username} 吗？`)) return;
    try {
      await adminApi.deleteUser(u.username);
      showMsg('success', `用户 ${u.username} 已删除`);
      load();
    } catch (e) {
      showMsg('error', `删除失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  const resetPwd = async (u: AdminUser) => {
    const pwd = prompt(`为 ${u.username} 设置新密码（至少 8 位）:`);
    if (!pwd || pwd.length < 8) return;
    try {
      await adminApi.updateUser(u.username, { password: pwd });
      showMsg('success', '密码已重置');
    } catch (e) {
      showMsg('error', `重置失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  if (!isAdmin) {
    return (
      <div className="admin-panel">
        <div className="empty-state">
          <div className="empty-icon">🛡️</div>
          <div className="empty-title">需要管理员权限</div>
          <div className="empty-desc">当前账号无后台管理权限，请使用管理员账号登录。</div>
        </div>
        <style>{`
          .admin-panel { padding: 20px 24px; }
          .empty-state { text-align:center; padding:80px 20px; }
          .empty-icon { font-size:48px; opacity:.4; margin-bottom:16px; }
          .empty-title { font-size:16px; color:var(--text-bright); margin-bottom:6px; }
          .empty-desc { font-size:13px; color:var(--muted); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <div className="am-header">
        <div>
          <h2>🛡️ 后台管理</h2>
          <span className="am-subtitle">用户管理 · 平台统计</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 新建用户</button>
      </div>

      {msg && (
        <div className={`am-toast ${msg.type}`}>
          {msg.type === 'success' ? '✅' : '❌'} {msg.text}
        </div>
      )}

      {/* 统计卡片 */}
      <div className="stat-cards" style={{ marginBottom: 20 }}>
        {[
          { label: '用户', val: stats?.users ?? '-', color: 'var(--primary)' },
          { label: 'Agent', val: stats?.agents ?? '-', color: 'var(--purple)' },
          { label: '任务', val: stats?.tasks ?? '-', color: 'var(--success)' },
          { label: '数据集', val: stats?.datasets ?? '-', color: 'var(--warn)' },
          { label: '技能', val: stats?.skills ?? '-', color: 'var(--teal)' },
        ].map((c) => (
          <div key={c.label} className="stat-card accent-blue">
            <div className="stat-val" style={{ color: c.color }}>{c.val}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 用户表格 */}
      <h3 style={{ fontSize: 14, color: 'var(--text-bright)', marginBottom: 10 }}>用户列表 ({users.length})</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>用户名</th><th>邮箱</th><th>角色</th><th>状态</th><th>注册时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>{loading ? '加载中...' : '暂无用户'}</td></tr>
          )}
          {users.map((u) => (
            <tr key={u.id}>
              <td style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{u.username}</td>
              <td style={{ fontSize: 12 }}>{u.email || '-'}</td>
              <td>
                <select
                  className="form-select"
                  value={u.role}
                  onChange={(e) => handleRole(u, e.target.value)}
                  style={{ padding: '2px 6px', fontSize: 12 }}
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </td>
              <td>
                <span className={`status-badge ${u.is_active ? 'completed' : 'failed'}`}>
                  {u.is_active ? '启用' : '禁用'}
                </span>
              </td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                {u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '-'}
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-xs" onClick={() => resetPwd(u)}>重置密码</button>
                  <button className="btn btn-xs" onClick={() => handleToggleActive(u)}>
                    {u.is_active ? '禁用' : '启用'}
                  </button>
                  <button className="btn btn-xs btn-danger" onClick={() => handleDelete(u)}>删除</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 新建用户弹窗 */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🆕 新建用户</h3>
            <div className="form-group">
              <label>用户名 *</label>
              <input className="form-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="2-32 位字母数字下划线中文" />
            </div>
            <div className="form-group">
              <label>密码 *（至少 8 位，含字母和数字）</label>
              <input type="password" className="form-input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="form-group">
              <label>邮箱</label>
              <input className="form-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="可选" />
            </div>
            <div className="form-group">
              <label>角色</label>
              <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .admin-panel { padding: 20px 24px; }
        .am-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }
        .am-header h2 { font-size:18px; color:var(--text-bright); }
        .am-subtitle { font-size:12px; color:var(--muted); display:block; margin-top:4px; }
        .am-toast { padding:10px 16px; border-radius:var(--radius); margin-bottom:16px; font-size:13px; }
        .am-toast.success { background:rgba(63,185,80,.12); color:var(--success); border:1px solid rgba(63,185,80,.3); }
        .am-toast.error { background:rgba(248,81,73,.12); color:var(--error); border:1px solid rgba(248,81,73,.3); }
      `}</style>
    </div>
  );
}
