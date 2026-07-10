import { useState, useEffect, useCallback } from 'react';
import { memoryApi } from '../api/client';

interface VcsCommit {
  id: string;
  message: string;
  timestamp: string;
  messages_count: number;
  messages_summary: string;
}

interface DiffResult {
  added: string[];
  removed: string[];
  count_before: number;
  count_after: number;
}

type SubTab = 'vcs' | 'graph' | 'recall' | 'compress';

export default function MemoryViewer() {
  const [subTab, setSubTab] = useState<SubTab>('vcs');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // VCS
  const [commits, setCommits] = useState<VcsCommit[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffIds, setDiffIds] = useState({ commit1: '', commit2: '' });

  // Graph
  const [graphData, setGraphData] = useState<{ node_count: number; edge_count: number } | null>(null);
  const [clusters, setClusters] = useState<{ keywords: string[]; size: number }[]>([]);

  // Recall
  const [recallQuery, setRecallQuery] = useState('');
  const [recallResult, setRecallResult] = useState('');

  // Compress
  const [compressResult, setCompressResult] = useState('');

  // Stats
  const [stats, setStats] = useState<Record<string, unknown>>({});

  // ── 加载 ──
  const loadStats = useCallback(async () => {
    try {
      const res = await memoryApi.stats();
      if (res.ok) setStats(res);
    } catch { /* ignore */ }
  }, []);

  const loadVcsLog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await memoryApi.vcsLog();
      setCommits(res.commits || []);
    } catch { setError('加载版本历史失败'); }
    finally { setLoading(false); }
  }, []);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const [gRes, cRes] = await Promise.all([memoryApi.graphData(), memoryApi.graphClusters()]);
      if (gRes.ok) setGraphData({ node_count: gRes.node_count, edge_count: gRes.edge_count });
      if (cRes.ok) setClusters(cRes.clusters || []);
    } catch { setError('加载图谱数据失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (subTab === 'vcs') loadVcsLog();
    else if (subTab === 'graph') loadGraph();
  }, [subTab, loadVcsLog, loadGraph]);

  // ── 操作 ──
  const handleCommit = async () => {
    setError('');
    try {
      const res = await memoryApi.vcsCommit(commitMsg);
      if (res.ok) {
        setCommitMsg('');
        loadVcsLog();
        loadStats();
      }
    } catch { setError('提交失败'); }
  };

  const handleCheckout = async (commitId: string) => {
    if (!confirm(`确定回退到 ${commitId}？当前未提交的对话将丢失。`)) return;
    try {
      const res = await memoryApi.vcsCheckout(commitId);
      if (res.ok) { alert('已回退'); loadVcsLog(); }
    } catch { setError('回退失败'); }
  };

  const handleDiff = async () => {
    if (!diffIds.commit1 || !diffIds.commit2) {
      setError('请选择两个版本');
      return;
    }
    setError('');
    try {
      const res = await memoryApi.vcsDiff(diffIds.commit1, diffIds.commit2);
      if (res.ok) setDiffResult(res.diff);
    } catch { setError('对比失败'); }
  };

  const handleRecall = async () => {
    if (!recallQuery.trim()) return;
    setLoading(true);
    try {
      const res = await memoryApi.recall(recallQuery);
      setRecallResult(res.result || '无结果');
    } catch { setError('检索失败'); }
    finally { setLoading(false); }
  };

  const handleCompress = async () => {
    setLoading(true);
    try {
      const res = await memoryApi.compress();
      setCompressResult(res.summary || '无可压缩内容');
    } catch { setError('压缩失败'); }
    finally { setLoading(false); }
  };

  // ── 渲染 ──
  return (
    <div className="memory-viewer">
      <div className="skill-market-header">
        <h2>🧠 记忆系统</h2>
        <p>Git式版本控制 · 记忆图谱索引 · 高无损LLM压缩</p>
      </div>

      {/* Stats bar */}
      {stats.ok && (
        <div className="memory-stats-bar">
          <div className="memory-stat-item">
            <span className="memory-stat-val">{String((stats.short_term as Record<string,unknown>)?.message_count || 0)}</span>
            <span className="memory-stat-label">短期消息</span>
          </div>
          <div className="memory-stat-item">
            <span className="memory-stat-val">{String((stats.vcs as Record<string,unknown>)?.commit_count || 0)}</span>
            <span className="memory-stat-label">版本快照</span>
          </div>
          <div className="memory-stat-item">
            <span className="memory-stat-val">{String((stats.graph as Record<string,unknown>)?.node_count || 0)}</span>
            <span className="memory-stat-label">图谱节点</span>
          </div>
          <div className="memory-stat-item">
            <span className="memory-stat-val">{String((stats.graph as Record<string,unknown>)?.edge_count || 0)}</span>
            <span className="memory-stat-label">关联边</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="skill-tabs">
        {(['vcs', 'graph', 'recall', 'compress'] as SubTab[]).map((tab) => (
          <button
            key={tab}
            className={`skill-tab${subTab === tab ? ' active' : ''}`}
            onClick={() => setSubTab(tab)}
          >
            {{ vcs: '版本控制', graph: '记忆图谱', recall: '记忆检索', compress: 'LLM 压缩' }[tab]}
          </button>
        ))}
      </div>

      {error && (
        <div className="skill-error" onClick={() => setError('')}>{error} <span style={{ cursor: 'pointer', marginLeft: 8 }}>✕</span></div>
      )}

      {/* ── 版本控制 ── */}
      {subTab === 'vcs' && (
        <div className="memory-content">
          {/* Commit */}
          <div className="memory-commit-bar">
            <input
              className="form-input"
              placeholder="提交说明（如：完成需求分析）"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleCommit}>💾 保存快照</button>
          </div>

          {/* Diff */}
          <div className="memory-diff-bar">
            <select className="form-select" value={diffIds.commit1} onChange={(e) => setDiffIds((d) => ({ ...d, commit1: e.target.value }))}>
              <option value="">选择基准版本</option>
              {commits.map((c) => (
                <option key={c.id} value={c.id}>{c.id.slice(0, 30)}... - {c.message}</option>
              ))}
            </select>
            <span style={{ color: 'var(--muted)', padding: '0 4px' }}>vs</span>
            <select className="form-select" value={diffIds.commit2} onChange={(e) => setDiffIds((d) => ({ ...d, commit2: e.target.value }))}>
              <option value="">选择对比版本</option>
              {commits.map((c) => (
                <option key={c.id} value={c.id}>{c.id.slice(0, 30)}... - {c.message}</option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={handleDiff}>对比</button>
          </div>

          {diffResult && (
            <div className="memory-diff-result">
              <div className="card-header">版本差异 (前: {diffResult.count_before} 条, 后: {diffResult.count_after} 条)</div>
              {diffResult.added.length > 0 && (
                <div>
                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>+ {diffResult.added.length} 新增</span>
                  {diffResult.added.map((a, i) => <div key={i} className="diff-line added">+ {a}</div>)}
                </div>
              )}
              {diffResult.removed.length > 0 && (
                <div>
                  <span style={{ color: 'var(--error)', fontWeight: 600 }}>- {diffResult.removed.length} 移除</span>
                  {diffResult.removed.map((r, i) => <div key={i} className="diff-line removed">- {r}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Commit log */}
          {loading ? (
            <div className="skill-loading"><span className="spinner" /> 加载中...</div>
          ) : commits.length === 0 ? (
            <div className="skill-empty">暂无版本快照，开始对话后会自动创建</div>
          ) : (
            <div className="memory-commit-list">
              {commits.map((c, idx) => (
                <div key={c.id} className={`memory-commit-item${idx === commits.length - 1 ? ' latest' : ''}`}>
                  <div className="commit-header">
                    <span className="commit-id">{c.id.slice(0, 12)}...</span>
                    {idx === commits.length - 1 && <span className="commit-badge">HEAD</span>}
                    <span className="commit-time">{c.timestamp?.slice(0, 19).replace('T', ' ')}</span>
                    <span className="commit-count">{c.messages_count} 条消息</span>
                  </div>
                  <div className="commit-msg">{c.message}</div>
                  <div className="commit-summary">{c.messages_summary}</div>
                  <div className="commit-actions">
                    <button className="btn btn-xs" onClick={() => handleCheckout(c.id)}>
                      回退到此版本
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 记忆图谱 ── */}
      {subTab === 'graph' && (
        <div className="memory-content">
          {loading ? (
            <div className="skill-loading"><span className="spinner" /> 加载中...</div>
          ) : (
            <>
              {graphData && (
                <div className="memory-graph-info">
                  共 {graphData.node_count} 个记忆节点，{graphData.edge_count} 条关联边
                </div>
              )}

              {clusters.length > 0 && (
                <div className="memory-clusters">
                  <h4>记忆主题聚类</h4>
                  {clusters.map((c, idx) => (
                    <div key={idx} className="cluster-item">
                      <div className="cluster-header">
                        <span className="cluster-size">主题 {idx + 1} ({c.size} 条)</span>
                      </div>
                      <div className="cluster-kw">
                        {c.keywords.map((kw) => (
                          <span key={kw} className="skill-tag">{kw}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(!graphData || graphData.node_count === 0) && (
                <div className="skill-empty">暂无记忆图谱数据，开始对话后自动构建</div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 记忆检索 ── */}
      {subTab === 'recall' && (
        <div className="memory-content">
          <div className="gh-search-bar">
            <input
              className="form-input"
              placeholder="输入关键词检索相关记忆..."
              value={recallQuery}
              onChange={(e) => setRecallQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRecall()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleRecall} disabled={loading}>
              {loading ? '检索中...' : '双路检索'}
            </button>
          </div>

          {recallResult && (
            <div className="memory-recall-result">
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{recallResult}</pre>
            </div>
          )}

          {!recallResult && !loading && (
            <div className="skill-empty">输入关键词进行双路检索（图谱 + 向量语义）</div>
          )}
        </div>
      )}

      {/* ── LLM 压缩 ── */}
      {subTab === 'compress' && (
        <div className="memory-content">
          <div className="card" style={{ maxWidth: 700 }}>
            <div className="card-header">LLM 高无损压缩</div>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
              使用 LLM 对当前对话历史进行智能压缩，保留关键事实、决策和上下文依赖。
              相比简单截断，信息损失率 &lt; 5%，压缩率可达 5-10x。
            </p>
            <button className="btn btn-primary" onClick={handleCompress} disabled={loading}>
              {loading ? '压缩中...' : '开始压缩'}
            </button>

            {compressResult && (
              <div className="memory-compress-result" style={{ marginTop: 20 }}>
                <div className="card-header">压缩结果</div>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
                  {compressResult}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
