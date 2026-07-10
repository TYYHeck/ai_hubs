import { useAppStore } from '../stores/appStore';
import type { DashboardStats } from '../types';

export default function Dashboard() {
  const stats = useAppStore((s) => s.dashboardStats);
  const tasks = useAppStore((s) => s.tasks);
  const agents = useAppStore((s) => s.agents);
  const systemInfo = useAppStore((s) => s.systemInfo);
  const currentModel = useAppStore((s) => s.currentModel);
  const currentProvider = useAppStore((s) => s.currentProvider);
  const toolsCount = useAppStore((s) => s.toolsCount);

  if (!stats) return <div className="loading"><span className="spinner" /> 正在加载仪表盘…</div>;

  const recentTasks = tasks.slice(0, 8);
  const runningTasks = tasks.filter((t) => t.status === 'running');
  const completedRate = stats.tasks_total > 0
    ? ((stats.tasks_completed / stats.tasks_total) * 100).toFixed(0)
    : '0';

  return (
    <div className="dashboard">
      <div className="dash-header">
        <h2>📊 仪表盘</h2>
        <span className="dash-subtitle">系统运行状态概览 · 数据每 15 秒自动刷新</span>
      </div>

      {/* 统计卡片 */}
      <div className="stat-grid">
        <StatCard icon="🤖" value={stats.agents} label="Agent 总数" color="blue" />
        <StatCard icon="✅" value={stats.idle_agents} label="空闲 Agent" color="green" />
        <StatCard icon="📋" value={stats.tasks_total} label="任务总数" color="purple" />
        <StatCard icon="⏳" value={stats.tasks_pending} label="等待中" color="yellow" />
        <StatCard icon="🔄" value={stats.tasks_running} label="运行中" color="blue" />
        <StatCard icon="✅" value={stats.tasks_completed} label="已完成" color="teal" />
        <StatCard icon="❌" value={stats.tasks_failed} label="失败" color="red" />
        <StatCard icon="📈" value={`${completedRate}%`} label="完成率" color="green" />
      </div>

      {/* 系统信息 + Agent 状态 */}
      <div className="dash-grid">
        <div className="card">
          <div className="card-header">🖥️ 系统信息</div>
          <div className="info-grid">
            <InfoRow label="模型" value={`${currentModel} (${currentProvider})`} />
            <InfoRow label="工具数" value={`${toolsCount} 个`} />
            {systemInfo && (
              <>
                <InfoRow label="Python" value={systemInfo.python_version} />
                <InfoRow label="系统" value={systemInfo.platform.slice(0, 40)} />
                <InfoRow label="CPU 核心" value={`${systemInfo.cpu_count} 核`} />
                <InfoRow label="内存占用" value={`${systemInfo.memory_used_mb.toFixed(1)} MB`} />
                <InfoRow label="运行时间" value={formatUptime(systemInfo.uptime_seconds)} />
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">🤖 Agent 状态</div>
          {agents.length === 0 ? (
            <div className="empty-state">暂无 Agent，请先创建</div>
          ) : (
            <div className="agent-list-compact">
              {agents.map((a) => (
                <div key={a.name} className="agent-row-compact">
                  <span className={`status-dot ${a.status}`} />
                  <span className="agent-name-compact">{a.name}</span>
                  <span className={`status-badge ${a.status}`}>{a.status === 'idle' ? '空闲' : '忙碌'}</span>
                  <span className="agent-skills-compact">
                    {a.skills.slice(0, 3).map((s) => (
                      <span key={s} className="skill-tag">{s}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 最近任务 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">📋 最近任务</div>
        {recentTasks.length === 0 ? (
          <div className="empty-state">暂无任务记录</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>标题</th>
                <th>状态</th>
                <th>Agent</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{t.id}</td>
                  <td>{t.title}</td>
                  <td><span className={`status-badge ${t.status}`}>{statusLabel(t.status)}</span></td>
                  <td>{t.assigned_agent || '--'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{formatTime(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 运行中的任务 */}
      {runningTasks.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">🔄 正在执行的任务</div>
          {runningTasks.map((t) => (
            <div key={t.id} className="running-task-row">
              <span className="spinner" style={{ width: 14, height: 14 }} />
              <span>{t.title}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t.assigned_agent}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .dashboard { padding:24px; max-width:1200px; }
        .dash-header { margin-bottom:20px; }
        .dash-header h2 { font-size:20px; color:var(--text-bright); }
        .dash-subtitle { font-size:12px; color:var(--muted); margin-top:4px; display:block; }
        .loading { padding:60px 24px; text-align:center; color:var(--muted); display:flex; align-items:center; justify-content:center; gap:10px; }

        .stat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:16px; }
        .stat-card-item { background:var(--card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:18px; text-align:center; transition:all .2s; }
        .stat-card-item:hover { transform:translateY(-2px); box-shadow:0 4px 16px rgba(0,0,0,.3); }
        .stat-card-item .stat-icon { font-size:28px; margin-bottom:6px; }
        .stat-card-item .stat-val { font-size:28px; font-weight:700; color:var(--text-bright); }
        .stat-card-item .stat-label { font-size:11px; color:var(--muted); margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }
        .stat-card-item.blue { border-top:3px solid var(--primary); }
        .stat-card-item.green { border-top:3px solid var(--success); }
        .stat-card-item.yellow { border-top:3px solid var(--warn); }
        .stat-card-item.red { border-top:3px solid var(--error); }
        .stat-card-item.purple { border-top:3px solid var(--purple); }
        .stat-card-item.teal { border-top:3px solid var(--teal); }

        .dash-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media (max-width:800px) { .dash-grid { grid-template-columns:1fr; } }

        .info-grid { display:flex; flex-direction:column; gap:8px; }
        .info-row { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(48,54,61,.4); }
        .info-row:last-child { border-bottom:none; }
        .info-row .info-label { color:var(--muted); font-size:12px; }
        .info-row .info-value { color:var(--text-bright); font-size:12px; font-weight:500; }

        .agent-list-compact { display:flex; flex-direction:column; gap:8px; }
        .agent-row-compact { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid rgba(48,54,61,.4); }
        .agent-row-compact:last-child { border-bottom:none; }
        .agent-name-compact { color:var(--text-bright); font-weight:500; font-size:13px; min-width:80px; }
        .agent-skills-compact { margin-left:auto; display:flex; gap:2px; flex-wrap:wrap; }

        .empty-state { padding:30px; text-align:center; color:var(--muted); font-size:13px; }
        .running-task-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid rgba(48,54,61,.4); }
        .running-task-row:last-child { border-bottom:none; }
      `}</style>
    </div>
  );
}

function StatCard({ icon, value, label, color }: { icon: string; value: number | string; label: string; color: string }) {
  return (
    <div className={`stat-card-item ${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-val">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: '等待中', running: '运行中', completed: '已完成',
    failed: '失败', cancelled: '已取消',
  };
  return map[s] || s;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
