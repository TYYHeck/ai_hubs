import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { datasetsApi } from '../api/client';
import type { DatasetInfo, DatasetRecord } from '../types';

const CATEGORIES = [
  { id: 'custom', name: '自定义' },
  { id: 'text', name: '文本语料' },
  { id: 'qa', name: '问答对' },
  { id: 'code', name: '代码样本' },
  { id: 'image', name: '图像描述' },
  { id: 'conversation', name: '对话记录' },
];

export default function DatasetManager() {
  const setDatasets = useAppStore((s) => s.setDatasets);
  const [datasets, setLocal] = useState<DatasetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: 'custom', tags: '' });
  const [viewDs, setViewDs] = useState<(DatasetInfo & { records: DatasetRecord[] }) | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await datasetsApi.list();
      if (res.ok) {
        setLocal(res.datasets);
        setDatasets(res.datasets);
      }
    } catch {
      showMsg('error', '加载数据集失败');
    } finally {
      setLoading(false);
    }
  }, [setDatasets]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) { showMsg('error', '数据集名称必填'); return; }
    try {
      const res = await datasetsApi.create({
        name: form.name.trim(),
        description: form.description,
        category: form.category,
        tags: form.tags.split(/[,，、]+/).map((t) => t.trim()).filter(Boolean),
      });
      if (res.ok) {
        showMsg('success', `数据集「${form.name}」创建成功`);
        setForm({ name: '', description: '', category: 'custom', tags: '' });
        setShowCreate(false);
        load();
      } else showMsg('error', '创建失败');
    } catch (e) {
      showMsg('error', `创建失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  const handleView = async (ds: DatasetInfo) => {
    try {
      const res = await datasetsApi.get(ds.id);
      if (res.ok) setViewDs(res.dataset);
    } catch {
      showMsg('error', '查看失败');
    }
  };

  const handleDelete = async (ds: DatasetInfo) => {
    if (!confirm(`确定删除数据集「${ds.name}」吗？`)) return;
    try {
      await datasetsApi.delete(ds.id);
      showMsg('success', '已删除');
      load();
    } catch (e) {
      showMsg('error', `删除失败: ${e instanceof Error ? e.message : ''}`);
    }
  };

  const handleExport = async (ds: DatasetInfo) => {
    try {
      const res = await datasetsApi.export(ds.id, 'json');
      if (res.ok) {
        const blob = new Blob([res.content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${ds.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      showMsg('error', '导出失败');
    }
  };

  return (
    <div className="dataset-manager">
      <div className="dm-header">
        <div>
          <h2>🗂️ 数据集管理</h2>
          <span className="dm-subtitle">创建、分类与配置训练/评估数据集（{datasets.length} 个）</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={load}>🔄 刷新</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 新建数据集</button>
        </div>
      </div>

      {msg && (
        <div className={`dm-toast ${msg.type}`}>
          {msg.type === 'success' ? '✅' : '❌'} {msg.text}
        </div>
      )}

      {datasets.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🗂️</div>
          <div className="empty-title">暂无数据集</div>
          <div className="empty-desc">点击「新建数据集」开始构建你的数据资产</div>
        </div>
      ) : (
        <div className="dm-grid">
          {datasets.map((ds) => (
            <div key={ds.id} className="dm-card">
              <div className="dm-card-header">
                <span className="dm-name">{ds.name}</span>
                <span className="dm-cat">{CATEGORIES.find((c) => c.id === ds.category)?.name || ds.category}</span>
              </div>
              <div className="dm-desc">{ds.description || '暂无描述'}</div>
              <div className="dm-meta">📊 {ds.record_count} 条记录 · 🕒 {ds.updated_at ? new Date(ds.updated_at).toLocaleDateString('zh-CN') : '-'}</div>
              {ds.tags.length > 0 && (
                <div className="dm-tags">
                  {ds.tags.map((t) => <span key={t} className="skill-tag">{t}</span>)}
                </div>
              )}
              <div className="dm-actions">
                <button className="btn btn-xs" onClick={() => handleView(ds)}>查看</button>
                <button className="btn btn-xs" onClick={() => handleExport(ds)}>导出</button>
                <button className="btn btn-xs btn-danger" onClick={() => handleDelete(ds)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🆕 新建数据集</h3>
            <div className="form-group">
              <label>数据集名称 *</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：客服问答集" />
            </div>
            <div className="form-group">
              <label>描述</label>
              <input className="form-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group">
              <label>分类</label>
              <select className="form-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>标签（逗号分隔）</label>
              <input className="form-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="训练, 评估" />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 查看弹窗 */}
      {viewDs && (
        <div className="modal-overlay" onClick={() => setViewDs(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
            <h3>📊 {viewDs.name} · {viewDs.record_count} 条记录</h3>
            <div className="dm-records">
              {viewDs.records.length === 0 && <div style={{ color: 'var(--muted)', padding: 20 }}>暂无记录</div>}
              {viewDs.records.slice(0, 50).map((r, i) => (
                <div key={r.id || i} className="dm-record">
                  <span className="dm-record-idx">#{i + 1}</span>
                  <pre>{JSON.stringify(r, null, 2).slice(0, 800)}</pre>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setViewDs(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dataset-manager { padding:20px 24px; }
        .dm-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }
        .dm-header h2 { font-size:18px; color:var(--text-bright); }
        .dm-subtitle { font-size:12px; color:var(--muted); display:block; margin-top:4px; }
        .dm-toast { padding:10px 16px; border-radius:var(--radius); margin-bottom:16px; font-size:13px; }
        .dm-toast.success { background:rgba(63,185,80,.12); color:var(--success); border:1px solid rgba(63,185,80,.3); }
        .dm-toast.error { background:rgba(248,81,73,.12); color:var(--error); border:1px solid rgba(248,81,73,.3); }
        .empty-state { text-align:center; padding:80px 20px; }
        .empty-icon { font-size:48px; opacity:.4; }
        .empty-title { font-size:16px; color:var(--text-bright); margin:8px 0; }
        .empty-desc { font-size:13px; color:var(--muted); }
        .dm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:16px; }
        .dm-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:14px 16px; }
        .dm-card-header { display:flex; justify-content:space-between; align-items:center; }
        .dm-name { font-weight:600; color:var(--text-bright); font-size:15px; }
        .dm-cat { font-size:11px; color:var(--primary); background:rgba(88,166,255,.1); padding:1px 8px; border-radius:10px; }
        .dm-desc { font-size:12px; color:var(--muted); margin:8px 0; min-height:18px; }
        .dm-meta { font-size:11px; color:var(--muted); }
        .dm-tags { display:flex; flex-wrap:wrap; gap:4px; margin:6px 0; }
        .dm-actions { display:flex; gap:6px; margin-top:10px; }
        .dm-records { max-height:60vh; overflow:auto; background:var(--code-bg); border:1px solid var(--border); border-radius:6px; padding:10px; }
        .dm-record { border-bottom:1px solid rgba(48,54,61,.4); padding:8px 0; }
        .dm-record-idx { color:var(--muted); font-size:11px; margin-right:8px; }
        .dm-record pre { font-size:11px; color:var(--text); white-space:pre-wrap; word-break:break-word; margin:0; }
      `}</style>
    </div>
  );
}
