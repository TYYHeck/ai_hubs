import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { tasksApi, orchestrateStream } from '../api/client';
import type { TaskInfo, OrchestrationProgress, OrchestrationMode } from '../types';

export default function TaskManager() {
  const tasks = useAppStore((s) => s.tasks);
  const taskFilter = useAppStore((s) => s.taskFilter);
  const queueStatus = useAppStore((s) => s.queueStatus);
  const selectedTask = useAppStore((s) => s.selectedTask);
  const orchestrationProgress = useAppStore((s) => s.orchestrationProgress);
  const orchestrationModes = useAppStore((s) => s.orchestrationModes);
  const agents = useAppStore((s) => s.agents);
  const setTasks = useAppStore((s) => s.setTasks);
  const setTaskFilter = useAppStore((s) => s.setTaskFilter);
  const setSelectedTask = useAppStore((s) => s.setSelectedTask);
  const setOrchestrationProgress = useAppStore((s) => s.setOrchestrationProgress);

  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMode, setNewTaskMode] = useState('auto');
  const [newTaskThinkDepth, setNewTaskThinkDepth] = useState(1);
  const [newTaskThinkVis, setNewTaskThinkVis] = useState('visible');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const agentTag = (evt: Record<string, unknown>): string => {
    const name = (evt.agent_name as string) || (evt.agent as string) || 'System';
    return `[${name}]`;
  };

  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [executionLog]);

  const refresh = async () => {
    try {
      const res = await tasksApi.list(taskFilter);
      setTasks(res.tasks || [], res.queue);
    } catch { /* ignore */ }
  };

  const filteredTasks = taskFilter
    ? tasks.filter((t) => t.status === taskFilter)
    : tasks;

  const handleOrchestrate = async () => {
    if (!newTaskDesc.trim() || isExecuting) return;
    setIsExecuting(true);
    setExecutionLog([]);
    setShowNewTask(false);

    orchestrateStream(
      newTaskDesc,
      newTaskTitle,
      newTaskMode,
      null,
      (evt) => {
        const stage = evt.stage as string;
        if (stage === 'start') {
          setExecutionLog((p) => [...p, `🚀 ${agentTag(evt)} 启动编排 · 模式: ${evt.mode || 'auto'} · ${evt.mode_reason || ''}`]);
        } else if (stage === 'mode_detected') {
          setExecutionLog((p) => [...p, `🔍 ${agentTag(evt)} 模式检测: ${evt.mode} — ${evt.reason || ''}`]);
        } else if (stage === 'workflow_alloc') {
          setExecutionLog((p) => [...p, `📋 ${agentTag(evt)} LLM 工作流分配: ${evt.mode} · Agent: ${(evt.agents as string[])?.join(', ') || '自动'}`]);
        } else if (stage === 'parallel_start') {
          setExecutionLog((p) => [...p, `⚡ ${agentTag(evt)} 并行执行开始 · ${evt.agent_count} 个 Agent`]);
        } else if (stage === 'agent_start') {
          setExecutionLog((p) => [...p, `🤖 ${agentTag(evt)} 开始工作 (${evt.index}/${evt.total})`]);
        } else if (stage === 'agent_done') {
          setExecutionLog((p) => [...p, `✅ ${agentTag(evt)} 完成 (${evt.index}/${evt.total})`]);
        } else if (stage === 'agent_think_start') {
          setExecutionLog((p) => [...p, `💭 ${agentTag(evt)} 正在思考...`]);
        } else if (stage === 'agent_think_end') {
          setExecutionLog((p) => [...p, `💡 ${agentTag(evt)} 思考完成`]);
        } else if (stage === 'agent_error') {
          setExecutionLog((p) => [...p, `❌ ${agentTag(evt)} 出错: ${evt.error}`]);
        } else if (stage === 'pipeline_start') {
          setExecutionLog((p) => [...p, `🔗 流水线启动 · ${evt.stages} 个阶段`]);
        } else if (stage === 'pipeline_stage') {
          setExecutionLog((p) => [...p, `📌 阶段 ${evt.stage}/${evt.total}: ${evt.agent} — ${evt.role}`]);
        } else if (stage === 'pipeline_stage_done') {
          setExecutionLog((p) => [...p, `✅ 阶段 ${evt.stage}/${evt.total} 完成: ${evt.agent}`]);
        } else if (stage === 'collab_start') {
          setExecutionLog((p) => [...p, `👥 协作讨论开始 · ${evt.members} 名成员`]);
        } else if (stage === 'collab_round1' || stage === 'collab_round2') {
          setExecutionLog((p) => [...p, `💬 第 ${stage === 'collab_round1' ? '一' : '二'} 轮讨论`]);
        } else if (stage === 'synthesizing' || stage === 'collab_synthesizing') {
          setExecutionLog((p) => [...p, `🧩 汇总综合中...`]);
        } else if (stage === 'orchestration_complete') {
          setExecutionLog((p) => [...p, `🎉 编排完成！`]);
          if (evt.final_result) {
            setExecutionLog((p) => [...p, `\n📄 最终结果:\n${(evt.final_result as string).slice(0, 2000)}`]);
          }
          setIsExecuting(false);
          refresh();
        } else if (stage === 'error') {
          setExecutionLog((p) => [...p, `❌ 错误: ${evt.error}`]);
          setIsExecuting(false);
        }
      },
      () => { setIsExecuting(false); refresh(); },
      (err) => {
        setExecutionLog((p) => [...p, `❌ 请求失败: ${err.message}`]);
        setIsExecuting(false);
      },
      newTaskThinkDepth,
      newTaskThinkVis,
    );

    setNewTaskDesc('');
    setNewTaskTitle('');
  };

  const viewTaskDetail = async (taskId: string) => {
    try {
      const res = await tasksApi.get(taskId);
      if (res.ok) setSelectedTask(res.task);
    } catch { /* */ }
  };

  return (
    <div className="task-manager">
      <div className="task-header">
        <h2>📋 任务编排</h2>
        <button className="btn btn-primary" onClick={() => setShowNewTask(true)} disabled={isExecuting}>
          + 新建编排任务
        </button>
      </div>

      {/* 队列状态条 */}
      <div className="queue-bar">
        <QueueStat label="等待中" value={queueStatus?.pending || 0} color="var(--warn)" />
        <QueueStat label="运行中" value={queueStatus?.running || 0} color="var(--primary)" />
        <QueueStat label="已完成" value={queueStatus?.completed || 0} color="var(--success)" />
        <QueueStat label="失败" value={queueStatus?.failed || 0} color="var(--error)" />
        <QueueStat label="Agent" value={`${queueStatus?.idle_agents || 0}/${queueStatus?.agents || 0} 空闲`} color="var(--purple)" />
      </div>

      {/* 执行日志 */}
      {executionLog.length > 0 && (
        <div className="execution-log">
          <div className="log-header">
            <span>📡 执行日志</span>
            {isExecuting && <span className="spinner" />}
            <button className="btn btn-sm" onClick={() => setExecutionLog([])}>清空</button>
          </div>
          <div className="log-body">
            {executionLog.map((line, i) => (
              <div key={i} className="log-line">{line}</div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="filter-bar">
        {['', 'pending', 'running', 'paused', 'completed', 'failed'].map((f) => (
          <button
            key={f}
            className={`btn btn-sm ${taskFilter === f ? 'btn-primary' : ''}`}
            onClick={() => setTaskFilter(f)}
          >
            {f === '' ? '全部' : statusLabel(f)}
          </button>
        ))}
        <button className="btn btn-sm" onClick={refresh} style={{ marginLeft: 'auto' }}>🔄 刷新</button>
      </div>

      {/* 任务列表 */}
      <div className="task-list">
        {filteredTasks.length === 0 ? (
          <div className="empty-state">暂无任务</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>标题</th>
                <th>描述</th>
                <th>状态</th>
                <th>Agent</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace', color: 'var(--primary)', fontSize: 12 }}>{t.id}</td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</td>
                  <td><span className={`status-badge ${t.status}`}>{statusLabel(t.status)}</span></td>
                  <td style={{ fontSize: 12 }}>{t.assigned_agent || '--'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(t.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-xs" onClick={() => viewTaskDetail(t.id)}>详情</button>
                      {t.status === 'running' && (
                        <button className="btn btn-xs" style={{ background: 'var(--warn)', color: '#000' }}
                          onClick={async () => { await tasksApi.pause(t.id); refresh(); }}>暂停</button>
                      )}
                      {t.status === 'paused' && (
                        <button className="btn btn-xs btn-primary"
                          onClick={async () => { await tasksApi.resume(t.id); refresh(); }}>恢复</button>
                      )}
                      {(t.status === 'pending' || t.status === 'running' || t.status === 'paused') && (
                        <button className="btn btn-xs btn-danger" onClick={async () => { await tasksApi.cancel(t.id); refresh(); }}>取消</button>
                      )}
                      <button className="btn btn-xs btn-danger" onClick={async () => { await tasksApi.delete(t.id); refresh(); }}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 任务详情弹窗 */}
      {selectedTask && <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} onRefresh={refresh} />}

      {/* 新建编排任务弹窗 */}
      {showNewTask && (
        <div className="modal-overlay" onClick={() => setShowNewTask(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>🚀 新建编排任务</h3>
            <div className="form-group">
              <label>任务标题</label>
              <input className="form-input" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="可选，自动从描述截取" />
            </div>
            <div className="form-group">
              <label>任务描述</label>
              <textarea className="form-textarea" rows={4} value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} placeholder="详细描述你要执行的任务，系统会自动选择最优执行策略..." />
            </div>
            <div className="form-group">
              <label>执行模式</label>
              <select className="form-select" value={newTaskMode} onChange={(e) => setNewTaskMode(e.target.value)}>
                <option value="auto">自动检测（推荐）</option>
                <option value="single">单 Agent</option>
                <option value="parallel">并行执行</option>
                <option value="pipeline">流水线</option>
                <option value="collaborative">协作讨论</option>
              </select>
              <div className="form-help">{orchestrationModes.find((m) => m.id === newTaskMode)?.desc}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label>思考深度（1-5）</label>
                <select className="form-select" value={newTaskThinkDepth} onChange={(e) => setNewTaskThinkDepth(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={d}>{d} {d >= 4 ? '（深度推理）' : ''}</option>
                  ))}
                </select>
                <div className="form-help">越高，推理越充分、输出越完整</div>
              </div>
              <div className="form-group">
                <label>思考可见性</label>
                <select className="form-select" value={newTaskThinkVis} onChange={(e) => setNewTaskThinkVis(e.target.value)}>
                  <option value="visible">完整可见</option>
                  <option value="summary">仅摘要</option>
                  <option value="hidden">隐藏思考过程</option>
                </select>
                <div className="form-help">控制执行中思考过程是否展示</div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowNewTask(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleOrchestrate} disabled={!newTaskDesc.trim()}>开始执行</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .task-manager { padding:20px 24px; }
        .task-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
        .task-header h2 { font-size:18px; color:var(--text-bright); }
        .queue-bar { display:flex; gap:16px; padding:12px 16px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius-lg); margin-bottom:16px; }
        .queue-stat { display:flex; flex-direction:column; align-items:center; }
        .queue-stat .q-val { font-size:22px; font-weight:700; }
        .queue-stat .q-label { font-size:11px; color:var(--muted); margin-top:2px; }
        .execution-log { background:var(--code-bg); border:1px solid var(--border); border-radius:var(--radius-lg); margin-bottom:16px; overflow:hidden; }
        .log-header { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border); font-size:13px; color:var(--text-bright); }
        .log-body { padding:12px 14px; max-height:320px; overflow-y:auto; font-family:'Cascadia Code',Consolas,monospace; font-size:12px; line-height:1.8; white-space:pre-wrap; }
        .log-line { color:var(--text); }
        .filter-bar { display:flex; gap:8px; margin-bottom:12px; }
        .task-list { overflow-x:auto; }
      `}</style>
    </div>
  );
}

function QueueStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="queue-stat">
      <span className="q-val" style={{ color }}>{value}</span>
      <span className="q-label">{label}</span>
    </div>
  );
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    pending: '等待中', running: '运行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
  };
  return m[s] || s;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

// ── 任务详情弹窗 ──
function TaskDetailModal({ task, onClose, onRefresh }: { task: TaskInfo; onClose: () => void; onRefresh: () => void }) {
  const isRunning = task.status === 'running';
  const isPaused = task.status === 'paused';
  const isPending = task.status === 'pending';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
        <h3>📋 任务详情: {task.id}</h3>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>标题</div>
          <div style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{task.title}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>描述</div>
          <div style={{ color: 'var(--text)', lineHeight: 1.5 }}>{task.description}</div>
        </div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
          <div><span style={{ color: 'var(--muted)', fontSize: 12 }}>状态: </span><span className={`status-badge ${task.status}`}>{statusLabel(task.status)}</span></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 12 }}>Agent: </span><span style={{ color: 'var(--text-bright)' }}>{task.assigned_agent || '未分配'}</span></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 12 }}>分析模式: </span><span style={{ color: 'var(--primary)' }}>{task.analysis_mode === 'ai' ? 'AI 智能分析' : '关键词匹配'}</span></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 12 }}>思考: </span><span style={{ color: 'var(--text-bright)' }}>深度{task.think_depth || 1} · {task.think_visibility === 'hidden' ? '隐藏' : task.think_visibility === 'summary' ? '仅摘要' : '可见'}</span></div>
        </div>

        {task.result && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>结果</div>
            <div className="detail-result">{task.result}</div>
          </div>
        )}

        {task.error && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>错误</div>
            <div className="detail-error">{task.error}</div>
          </div>
        )}

        {task.output_files.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>输出文件</div>
            {task.output_files.map((f) => (
              <div key={f} style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--primary)', padding: '2px 0' }}>{f}</div>
            ))}
          </div>
        )}

        {task.event_log.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>事件日志 ({task.event_log.length})</div>
            <div className="event-log-box">
              {task.event_log.map((e, i) => (
                <div key={i} className="event-item">
                  <span className="event-time">{e.time}</span>
                  <span className="event-name">{e.event}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          {isRunning && <button className="btn" style={{ background: 'var(--warn)', color: '#000' }} onClick={async () => { await tasksApi.pause(task.id); onRefresh(); }}>⏸ 暂停任务</button>}
          {isPaused && <button className="btn btn-primary" onClick={async () => { await tasksApi.resume(task.id); onRefresh(); }}>▶ 恢复任务</button>}
          {(isRunning || isPaused || isPending) && <button className="btn btn-danger" onClick={async () => { await tasksApi.cancel(task.id); onRefresh(); onClose(); }}>取消任务</button>}
          <button className="btn btn-danger" onClick={async () => { await tasksApi.delete(task.id); onRefresh(); onClose(); }}>删除任务</button>
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>

      <style>{`
        .detail-result { background:var(--code-bg); border:1px solid var(--border); border-radius:6px; padding:12px; max-height:200px; overflow:auto; white-space:pre-wrap; font-size:13px; line-height:1.6; }
        .detail-error { background:rgba(248,81,73,.15); border:1px solid var(--error); border-radius:6px; padding:12px; max-height:200px; overflow:auto; white-space:pre-wrap; font-size:13px; color:#faa; }
        .event-log-box { max-height:200px; overflow:auto; background:var(--code-bg); border:1px solid var(--border); border-radius:6px; padding:8px 12px; }
        .event-item { padding:4px 0; border-bottom:1px solid rgba(48,54,61,.4); font-size:12px; }
        .event-item:last-child { border-bottom:none; }
        .event-time { color:var(--muted); margin-right:10px; font-family:monospace; font-size:11px; }
        .event-name { color:var(--text-bright); }
      `}</style>
    </div>
  );
}
