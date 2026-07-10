import { useState, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { knowledgeApi } from '../api/client';
import type { KnowledgeSource } from '../types';

export default function KnowledgeBase() {
  const kbSources = useAppStore((s) => s.kbSources);
  const kbStats = useAppStore((s) => s.kbStats);
  const setKbSources = useAppStore((s) => s.setKbSources);

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ ok: number; results: unknown[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<unknown[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const refresh = useCallback(async () => {
    try {
      const res = await knowledgeApi.files();
      setKbSources(res.sources || [], { chunks: res.total_chunks, sources: res.total_sources });
    } catch { /* ignore */ }
  }, [setKbSources]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const res = await knowledgeApi.upload(files);
      setUploadResult({ ok: res.uploaded || 0, results: res.results || [] });
      if (res.ok) {
        showMsg('success', `成功上传 ${res.uploaded}/${res.total} 个文件`);
      } else {
        showMsg('error', `上传失败`);
      }
      await refresh();
    } catch (e) {
      showMsg('error', `上传失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(e.type === 'dragover' || e.type === 'dragenter');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const res = await knowledgeApi.search(searchQuery.trim());
      setSearchResults((res.results as unknown[]) || []);
    } catch {
      showMsg('error', '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('确定要清空整个知识库吗？此操作不可撤销！')) return;
    try {
      await knowledgeApi.clear();
      showMsg('success', '知识库已清空');
      await refresh();
    } catch {
      showMsg('error', '清空失败');
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    try {
      await knowledgeApi.deleteSource(sourceId);
      showMsg('success', `已删除 "${sourceId}"`);
      setDeleteTarget(null);
      await refresh();
    } catch {
      showMsg('error', '删除失败');
    }
  };

  const totalChunks = kbStats?.chunks || 0;
  const totalSources = kbStats?.sources || 0;

  // 上传结果的文件名列表
  const uploadedNames = uploadResult?.results
    ? (uploadResult.results as { file: string; ok: boolean; error?: string }[]).map((r) => r.file)
    : [];

  return (
    <div className="kb-container">
      {/* 头部 */}
      <div className="kb-header">
        <div>
          <h2><KbIcon /> 知识库管理</h2>
          <span className="kb-subtitle">
            {totalSources} 个文件 · {totalChunks} 个文本块 · RAG 检索增强
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={refresh}>&#x21bb; 刷新</button>
          {kbSources.length > 0 && (
            <button className="btn btn-sm btn-danger" onClick={handleClearAll}>清空全部</button>
          )}
        </div>
      </div>

      {/* 状态消息 */}
      {statusMsg && (
        <div className={`kb-toast ${statusMsg.type}`}>
          {statusMsg.type === 'success' ? '✅' : '❌'} {statusMsg.text}
        </div>
      )}

      {/* 操作区：上传 + 搜索 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* 上传区 */}
        <div
          className={`kb-dropzone ${isDragOver ? 'active' : ''} ${uploading ? 'uploading' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.py,.js,.ts,.json,.yaml,.yml,.html,.css,.pdf"
            onChange={(e) => handleUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          {uploading ? (
            <div className="kb-dropcontent">
              <div className="spinner" />
              <div className="kb-droptitle">正在上传并向量化...</div>
              <div className="kb-dropsub">文件将自动分块、嵌入并存入 ChromaDB</div>
              {uploadedNames.length > 0 && (
                <div className="kb-uploading-list">
                  {uploadedNames.map((n) => (
                    <span key={n} className="kb-uploading-file">{n}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="kb-dropcontent">
              <div className="kb-dropicon">
                <UploadIcon />
              </div>
              <div className="kb-droptitle">拖拽文件到此处上传</div>
              <div className="kb-dropsub">或点击选择文件 · 支持 txt / md / py / js / ts / json / yaml / html / css / pdf</div>
              <div className="kb-dropsub">单文件 ≤ 20MB · 支持多文件同时上传</div>
            </div>
          )}
        </div>

        {/* 搜索区 */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card-header" style={{ marginBottom: 0, paddingBottom: 8 }}>
            🔍 知识库检索
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入检索关键词..."
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
              {searching ? <span className="spinner" /> : '搜索'}
            </button>
          </div>

          {searchResults !== null && (
            <div className="kb-search-results">
              {searchResults.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                  未找到相关结果
                </div>
              ) : (
                (searchResults as { content: string; source: string; score: number; metadata?: Record<string, unknown> }[]).map((r, i) => (
                  <div key={i} className="kb-search-item">
                    <div className="kb-search-meta">
                      <span className="kb-search-source">{r.source || r.metadata?.filename as string || '未知来源'}</span>
                      <span className="kb-search-score">相似度: {(r.score * 100).toFixed(1)}%</span>
                    </div>
                    <div className="kb-search-text">{r.content.slice(0, 300)}{r.content.length > 300 ? '...' : ''}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 上传结果详情 */}
      {uploadResult && uploadResult.results && (uploadResult.results as { file: string; ok: boolean; error?: string; size?: number; chars?: number }[]).length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            上传详情 ({uploadResult.ok}/{uploadResult.results.length} 成功)
            <button className="btn btn-xs" style={{ float: 'right' }} onClick={() => setUploadResult(null)}>关闭</button>
          </div>
          <div className="kb-upload-details">
            {(uploadResult.results as { file: string; ok: boolean; error?: string; size?: number; chars?: number }[]).map((r) => (
              <div key={r.file} className={`kb-upload-row ${r.ok ? 'ok' : 'fail'}`}>
                <span>{r.ok ? '✅' : '❌'}</span>
                <span style={{ flex: 1 }}>{r.file}</span>
                {r.ok && (
                  <>
                    <span className="kb-upload-stat">{formatBytes(r.size || 0)}</span>
                    <span className="kb-upload-stat">{r.chars?.toLocaleString()} 字符</span>
                  </>
                )}
                {!r.ok && <span className="kb-upload-error">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 文件列表 */}
      <div className="card">
        <div className="card-header">
          📂 已存储文件 ({kbSources.length})
        </div>
        {kbSources.length === 0 ? (
          <div className="kb-empty">
            <div style={{ fontSize: 36, marginBottom: 12, opacity: .3 }}><KbIcon /></div>
            <div style={{ color: 'var(--muted)' }}>知识库为空，上传文件以启用 RAG 检索增强</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>类型</th>
                <th>大小</th>
                <th>文本块</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {kbSources.map((s) => (
                <tr key={s.source_id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-bright)' }}>
                      {s.filename}
                    </span>
                  </td>
                  <td>
                    <span className="kb-ext-badge">{s.ext}</span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>
                    {formatBytes(s.size)}
                  </td>
                  <td>
                    <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{s.chunks}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>块</span>
                  </td>
                  <td>
                    <button className="btn btn-xs btn-danger" onClick={() => setDeleteTarget(s.source_id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 380 }}>
            <h3>⚠️ 确认删除</h3>
            <p style={{ color: 'var(--text)', margin: '12px 0', lineHeight: 1.6 }}>
              确定要从知识库中删除 <strong style={{ color: 'var(--text-bright)' }}>"{deleteTarget}"</strong> 的所有文本块吗？
            </p>
            <div className="modal-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
              <button className="btn" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn btn-danger" onClick={() => handleDeleteSource(deleteTarget)}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .kb-container { padding: 20px 24px; }
        .kb-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
        .kb-header h2 { font-size: 18px; color: var(--text-bright); display: flex; align-items: center; gap: 8px; }
        .kb-subtitle { font-size: 12px; color: var(--muted); margin-top: 4px; display: block; }
        .kb-toast { padding: 10px 16px; border-radius: var(--radius); margin-bottom: 16px; font-size: 13px; animation: slideUp 0.3s; }
        .kb-toast.success { background: rgba(63,185,80,.12); color: var(--success); border: 1px solid rgba(63,185,80,.3); }
        .kb-toast.error { background: rgba(248,81,73,.12); color: var(--error); border: 1px solid rgba(248,81,73,.3); }

        .kb-dropzone { border: 2px dashed var(--border); border-radius: var(--radius-lg); padding: 32px; cursor: pointer;
          transition: all .2s; text-align: center; min-height: 200px; display: flex; align-items: center; justify-content: center; }
        .kb-dropzone:hover, .kb-dropzone.active { border-color: var(--primary); background: var(--primary-bg); }
        .kb-dropzone.uploading { border-color: var(--primary); background: var(--primary-bg); cursor: default; }
        .kb-dropcontent { text-align: center; }
        .kb-dropicon { margin-bottom: 12px; color: var(--muted); opacity: .5; }
        .kb-dropicon svg { width: 48px; height: 48px; }
        .kb-droptitle { font-size: 15px; color: var(--text-bright); margin-bottom: 6px; }
        .kb-dropsub { font-size: 12px; color: var(--muted); }

        .kb-uploading-list { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
        .kb-uploading-file { font-size: 11px; background: var(--card); color: var(--primary); padding: 2px 10px; border-radius: 10px;
          font-family: monospace; border: 1px solid var(--border); }

        .kb-search-results { max-height: 300px; overflow-y: auto; }
        .kb-search-item { padding: 10px 12px; border-bottom: 1px solid var(--border); }
        .kb-search-item:last-child { border-bottom: none; }
        .kb-search-meta { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px; }
        .kb-search-source { color: var(--primary); font-weight: 500; }
        .kb-search-score { color: var(--muted); }
        .kb-search-text { font-size: 12px; color: var(--text); line-height: 1.5; }

        .kb-upload-details { max-height: 240px; overflow-y: auto; }
        .kb-upload-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
        .kb-upload-row:last-child { border-bottom: none; }
        .kb-upload-row.ok { color: var(--text); }
        .kb-upload-row.fail { color: var(--error); }
        .kb-upload-stat { font-size: 11px; color: var(--muted); font-family: monospace; }
        .kb-upload-error { font-size: 12px; color: var(--error); }

        .kb-ext-badge { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 11px;
          background: var(--primary-bg); color: var(--primary); font-family: monospace; font-weight: 600; }
        .kb-empty { text-align: center; padding: 48px 20px; }
      `}</style>
    </div>
  );
}

function KbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
