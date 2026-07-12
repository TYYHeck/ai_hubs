import { useState, useEffect } from 'react'
import { ListTodo, Plus, Play, Pause, RotateCw, Trash2, Clock, GitBranch, Zap, X, ChevronDown, ChevronRight, Sparkles, Brain, FileText, Download, Eye, Wrench, CheckCircle2, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, ideApi } from '../api/client'
import { onAIMutation } from '../stores/chatStore'
import { FilePreviewButton } from '../components/FilePreviewModal'

interface TaskData {
  id: string; title: string; description: string; status: string
  mode: string; priority: number; assigned_agent: string | null
  think_depth: number; think_visibility: string
  result: string | null; error: string | null
  output_files?: { path: string; name: string; size: number; is_new: boolean; ext: string }[]
  created_at: string | null; started_at: string | null; finished_at: string | null
  events?: Array<{ event: string; data: Record<string, any> }>
  metadata?: Record<string, any>
}

interface ModeInfo { id: string; name: string; desc: string; icon: string }

const modeNames: Record<string, string> = {
  auto: 'AI 自动',
  single: '单 Agent',
  sequential: '串行执行',
  parallel: '并行执行',
  debate: '辩论模式',
  vote: '投票模式',
  hierarchical: '分层管理',
  swarm: '群体协作',
  custom: '自定义',
  workflow: '工作流',
}

function getModeName(mode: string): string {
  return modeNames[mode] || mode
}

function getAutoWorkflowInfo(events: Array<{ event: string; data: Record<string, any> }> | undefined): { mode: string; reason: string; agent: string; name?: string } | null {
  if (!events) return null
  const assigned = events.find(e => e.event === 'auto_assigned')
  if (!assigned?.data) return null
  const wf = assigned.data.workflow_mode
  const reason = assigned.data.workflow_reason
  const agent = assigned.data.agent
  const name = assigned.data.workflow_name
  if (wf) return { mode: wf, reason: reason || '', agent: agent || '', name: name || '' }
  return null
}

function safeSlice(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str
  let result = ''
  let count = 0
  for (const ch of str) {
    if (count >= maxLen) break
    result += ch
    count++
  }
  return result
}

function formatToolArgs(args: Record<string, any> | undefined): string {
  if (!args || Object.keys(args).length === 0) return ''
  try {
    const cloned: Record<string, any> = {}
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && v.length > 200) {
        cloned[k] = v.slice(0, 200) + '…'
      } else {
        cloned[k] = v
      }
    }
    return JSON.stringify(cloned, null, 2)
  } catch {
    return ''
  }
}

function getToolSummary(args: Record<string, any> | undefined, toolName: string): string {
  if (!args) return ''
  if (toolName === 'write_file' && args.path) {
    return `写入文件: ${args.path}`
  }
  if (toolName === 'read_file' && args.path) {
    return `读取文件: ${args.path}`
  }
  if (toolName === 'run_command' && args.command) {
    return `执行命令: ${String(args.command).slice(0, 60)}`
  }
  if (toolName === 'call_internal_api' && args.endpoint) {
    const ep = String(args.endpoint)
    if (ep.includes('/agents')) return '查询 Agent 信息'
    if (ep.includes('/tasks')) return '查询任务信息'
    if (ep.includes('/datasets')) return '查询数据集'
    if (ep.includes('/memory')) return '查询记忆'
    if (ep.includes('/skills')) return '查询技能'
    if (ep.includes('/workspace') || ep.includes('/ide')) return '查询工作区'
    return '查询平台信息'
  }
  if (toolName === 'request_user_input') {
    const itype = String(args.interaction_type || '')
    const title = String(args.title || '')
    const typeNames: Record<string, string> = {
      confirm: '确认',
      select: '选择',
      multi_select: '多选',
      form: '表单填写',
    }
    const typeLabel = typeNames[itype] || '交互'
    return title ? `${typeLabel}: ${title}` : `请求用户${typeLabel}`
  }
  return ''
}

function shouldShowTool(toolName: string): boolean {
  const internalTools = ['call_internal_api']
  return !internalTools.includes(toolName)
}

const modeIcons: Record<string, JSX.Element> = {
  user: <Zap size={14} />, 'arrow-right': <GitBranch size={14} />,
  'git-branch': <GitBranch size={14} />, 'message-square': <GitBranch size={14} />,
  'check-square': <GitBranch size={14} />, 'git-merge': <GitBranch size={14} />,
  'share-2': <GitBranch size={14} />, sliders: <GitBranch size={14} />,
  sparkles: <Sparkles size={14} />,
}
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  running: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-500/20 text-green-600 dark:text-green-400',
  failed: 'bg-red-500/20 text-red-600 dark:text-red-400',
  paused: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  cancelled: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskData[]>([])
  const [modes, setModes] = useState<ModeInfo[]>([])
  const [agents, setAgents] = useState<{id:number;name:string}[]>([])
  const [workflows, setWorkflows] = useState<{id:string;name:string;enabled?:boolean}[]>([])
  const enabledWorkflows = workflows.filter(w => w.enabled !== false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '', description: '', mode: 'auto', agent_ids: [] as number[],
    think_depth: 1, think_visibility: 'visible' as string, priority: 0, tags: '',
    assignment: 'direct' as string,
    workflow_id: '',
    allowed_workflows: [] as string[],
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [expandedToolArgs, setExpandedToolArgs] = useState<Record<string, boolean>>({})
  const [expandedToolResult, setExpandedToolResult] = useState<Record<string, boolean>>({})

  const toggleToolArgs = (taskId: string, evtIdx: number) => {
    const key = `${taskId}-args-${evtIdx}`
    setExpandedToolArgs(prev => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleToolResult = (taskId: string, evtIdx: number) => {
    const key = `${taskId}-result-${evtIdx}`
    setExpandedToolResult(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const fetchData = async () => {
    try {
      const [tRes, mRes, aRes, wfRes] = await Promise.all([
        api.get<TaskData[]>('/tasks'),
        api.get<ModeInfo[]>('/tasks/modes'),
        api.get<{ id: number; name: string }[]>('/agents'),
        api.get<{id:string;name:string}[]>('/workflows'),
      ])
      setTasks(tRes ?? [])
      setModes(mRes ?? [])
      setAgents((aRes ?? []).map((a) => ({ id: a.id, name: a.name })))
      setWorkflows(wfRes ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])
  // 每5秒自动刷新任务状态
  useEffect(() => {
    const iv = setInterval(fetchData, 5000)
    return () => clearInterval(iv)
  }, [])
  // 监听 AI 触发的资源变更 → 立即刷新
  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'tasks') fetchData()
    })
  }, [])

  const resetForm = () => {
    setForm({ title: '', description: '', mode: 'auto', agent_ids: [], think_depth: 1, think_visibility: 'visible', priority: 0, tags: '', assignment: 'direct', workflow_id: '', allowed_workflows: [] })
    setShowForm(false)
    setError('')
  }

  const handleCreate = async () => {
    if (!form.title.trim()) { setError('标题不能为空'); return }
    const submitMode = form.workflow_id ? 'workflow' : form.mode
    if (submitMode === 'workflow' && !form.workflow_id) { setError('请选择要绑定的工作流'); return }
    setSubmitting(true)
    try {
      const payload: any = {
        ...form,
        mode: submitMode,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      }
      delete payload.allowed_workflows
      await api.post('/tasks', payload)
      resetForm()
      fetchData()
    } catch (e: any) {
      setError(e.response?.data?.detail || '创建失败')
    }
    setSubmitting(false)
  }

  const handleExecute = async (taskId: string) => {
    await api.post(`/tasks/${taskId}/execute`)
    fetchData()
  }

  const handlePause = async (taskId: string) => {
    await api.post(`/tasks/${taskId}/pause`)
    fetchData()
  }

  const handleResume = async (taskId: string) => {
    await api.post(`/tasks/${taskId}/resume`)
    fetchData()
  }

  const handleDelete = async (taskId: string) => {
    if (!confirm('确定删除此任务？')) return
    await api.delete(`/tasks/${taskId}`)
    fetchData()
  }

  const toggleAgent = (id: number) => {
    setForm(prev => ({
      ...prev,
      agent_ids: prev.agent_ids.includes(id)
        ? prev.agent_ids.filter(a => a !== id)
        : [...prev.agent_ids, id],
    }))
  }

  if (loading) return <div className="p-8 text-text-muted">加载中...</div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <ListTodo size={22} className="text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">任务管理</h1>
          <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded">{tasks.length} 个</span>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm transition-colors">
          <Plus size={16} /> 新建任务
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {showForm && (
        <div className="mx-6 mt-4 bg-bg-secondary border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-text-primary font-medium">新建任务</h3>
            <button onClick={resetForm} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">标题 *</label>
              <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none" placeholder="任务名称" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">编排模式</label>
              <select value={form.mode} onChange={e => setForm({...form, mode: e.target.value})}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none">
                {modes.filter(m => m.id !== 'workflow').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {enabledWorkflows.length > 0 && (
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">绑定工作流（可选 · 选中后按该工作流拓扑运行）</label>
                <select value={form.workflow_id} onChange={e => setForm({...form, workflow_id: e.target.value})}
                  className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none">
                  <option value="">— 不绑定（按上方编排模式执行）—</option>
                  {enabledWorkflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            )}
            {form.mode === 'auto' && (
              <div>
                <label className="block text-xs text-text-muted mb-1">指派策略</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setForm({...form, assignment: 'direct'})}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors ${
                      form.assignment === 'direct'
                        ? 'bg-accent/20 border-accent/40 text-accent'
                        : 'bg-bg-tertiary border-border text-text-muted hover:text-text-secondary'
                    }`}>
                    <Zap size={13} /> 直接匹配
                  </button>
                  <button type="button" onClick={() => setForm({...form, assignment: 'ai'})}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors ${
                      form.assignment === 'ai'
                        ? 'bg-accent/20 border-accent/40 text-accent'
                        : 'bg-bg-tertiary border-border text-text-muted hover:text-text-secondary'
                    }`}>
                    <Brain size={13} /> AI 分析指派
                  </button>
                </div>
                <p className="text-[10px] text-text-dim mt-1">
                  {form.assignment === 'ai'
                    ? 'AI 会先分析任务内容与各 Agent 画像，再做更精细的指派'
                    : '根据任务内容的标签/关键词直接匹配最合适的 Agent'}
                </p>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-xs text-text-muted mb-1">描述 / 输入</label>
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none resize-none"
                placeholder="告诉 Agent 要做什么..." />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">思考深度 {form.think_depth}</label>
              <input type="range" min="1" max="3" value={form.think_depth}
                onChange={e => setForm({...form, think_depth: parseInt(e.target.value)})}
                className="w-full accent-accent" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">思考可见性</label>
              <select value={form.think_visibility} onChange={e => setForm({...form, think_visibility: e.target.value})}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none">
                <option value="visible">可见</option>
                <option value="hidden">隐藏</option>
                <option value="folded">折叠</option>
              </select>
            </div>
          </div>
          {/* Agent 选择 */}
          <div className="mt-4">
            <label className="block text-xs text-text-muted mb-2">选择 Agent ({form.agent_ids.length} 个已选)</label>
            <div className="flex flex-wrap gap-2">
              {agents.map(a => (
                <button key={a.id}
                  onClick={() => toggleAgent(a.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    form.agent_ids.includes(a.id)
                      ? 'bg-accent/20 border-accent/40 text-accent'
                      : 'bg-bg-tertiary border-border text-text-muted hover:text-text-secondary'
                  }`}>
                  {form.agent_ids.includes(a.id) ? '✓' : '+'} {a.name}
                </button>
              ))}
              {agents.length === 0 && <span className="text-xs text-text-dim">暂无 Agent，请先创建</span>}
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleCreate} disabled={submitting}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm transition-colors">
              <Plus size={14} /> {submitting ? '创建中…' : '创建'}
            </button>
            <button onClick={resetForm} className="text-text-muted hover:text-text-primary px-4 py-2 text-sm transition-colors">取消</button>
          </div>
        </div>
      )}

      {/* 任务列表 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {tasks.length === 0 ? (
          <div className="text-center text-text-muted mt-20">
            <ListTodo size={48} className="mx-auto mb-4 opacity-30" />
            <p>还没有任务，点击上方按钮创建</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map(t => (
              <div key={t.id}
                className={`bg-bg-secondary border rounded-xl overflow-hidden transition-colors ${
                  expandedId === t.id ? 'border-accent/40' : 'border-border hover:border-text-dim'
                }`}>
                <div className="p-4 flex items-start justify-between cursor-pointer"
                  onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColors[t.status] || 'text-text-muted'}`}>
                        {t.status === 'pending' ? '等待中' : t.status === 'running' ? '运行中' : t.status === 'completed' ? '已完成' : t.status === 'failed' ? '失败' : t.status === 'paused' ? '已暂停' : t.status}
                      </span>
                      <span className="text-text-primary font-medium truncate">{t.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">
                        {t.mode === 'workflow'
                          ? (t.metadata?.workflow_name || '工作流')
                          : t.mode === 'auto' ? (() => {
                              const wf = getAutoWorkflowInfo(t.events)
                              if (!wf) return 'AI 自动'
                              return wf.name ? `AI → ${wf.name}` : `AI → ${getModeName(wf.mode)}`
                            })() : getModeName(t.mode)}
                      </span>
                    </div>
                    <p className="text-text-muted text-xs truncate">{t.description || '无描述'}</p>
                    {t.assigned_agent && (
                      <p className="text-text-dim text-[11px] mt-1">指派: {t.assigned_agent}</p>
                    )}
                    {t.result && (
                      <div className="text-xs mt-1 bg-bg-tertiary rounded p-2 prose dark:prose-invert prose-xs max-w-none overflow-hidden"
                        style={{ maxHeight: '6em' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {t.result.length > 280 ? t.result.slice(0, 280) + '…' : t.result}
                        </ReactMarkdown>
                      </div>
                    )}
                    {t.output_files && t.output_files.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 text-[11px] text-green-600 dark:text-green-400">
                        <FileText size={11} />
                        {t.output_files.length} 个产出文件
                      </div>
                    )}
                    {t.error && (
                      <p className="text-red-600 dark:text-red-400 text-xs mt-1 bg-red-500/10 rounded p-2">{t.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-3" onClick={e => e.stopPropagation()}>
                    {t.status === 'pending' && (
                      <button onClick={() => handleExecute(t.id)}
                        className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors" title="执行">
                        <Play size={15} />
                      </button>
                    )}
                    {t.status === 'running' && (
                      <button onClick={() => handlePause(t.id)}
                        className="p-1.5 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors" title="暂停">
                        <Pause size={15} />
                      </button>
                    )}
                    {t.status === 'paused' && (
                      <button onClick={() => handleResume(t.id)}
                        className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" title="恢复">
                        <RotateCw size={15} />
                      </button>
                    )}
                    <button onClick={() => handleDelete(t.id)}
                      className="p-1.5 text-text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-bg-tertiary rounded-lg transition-colors" title="删除">
                      <Trash2 size={15} />
                    </button>
                    <span className="text-text-dim ml-1">
                      {expandedId === t.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </div>
                </div>
                {/* 展开详情 */}
                {expandedId === t.id && (
                  <div className="px-4 pb-4 border-t border-border pt-3">
                    <div className="grid grid-cols-4 gap-3 text-xs text-text-secondary mb-4">
                      <div>
                        <span className="text-text-muted text-[10px] uppercase tracking-wide">模式</span>
                        <br />
                        <span className="text-text-primary">
                          {t.mode === 'workflow'
                            ? (t.metadata?.workflow_name || '工作流')
                            : (() => {
                                const base = getModeName(t.mode)
                                if (t.mode !== 'auto') return base
                                const wf = getAutoWorkflowInfo(t.events)
                                return wf ? <>{base} <span className="text-text-dim ml-1">→ {wf.name || getModeName(wf.mode)}</span></> : base
                              })()}
                        </span>
                      </div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">优先级</span><br /><span className="text-text-primary">{t.priority}</span></div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">思考深度</span><br /><span className={t.think_depth > 1 ? 'text-accent font-medium' : 'text-text-primary'}>{t.think_depth}</span></div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">思考可见</span><br /><span className="text-text-primary">{t.think_visibility}</span></div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">创建</span><br /><span className="text-text-primary">{t.created_at?.slice(0, 16) || '-'}</span></div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">开始</span><br /><span className="text-text-primary">{t.started_at?.slice(0, 16) || '-'}</span></div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">完成</span><br /><span className="text-text-primary">{t.finished_at?.slice(0, 16) || '-'}</span></div>
                      <div><span className="text-text-muted text-[10px] uppercase tracking-wide">ID</span><br /><span className="font-mono text-text-primary">{t.id.slice(0, 8)}</span></div>
                    </div>

                    {/* 工作流阶段时间线 - 所有模式都显示 */}
                    {t.events && t.events.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs text-text-muted font-medium mb-2 flex items-center gap-2">
                          <GitBranch size={12} /> 工作流阶段
                          <span className="text-text-dim font-normal">({t.events.filter(e => !(e.event === 'tool_start' || e.event === 'tool_result') || shouldShowTool(e.data?.tool || '')).length} 个步骤)</span>
                        </div>
                        <div className="bg-bg-tertiary rounded-lg p-3 max-h-[300px] overflow-y-auto">
                          <div className="relative">
                            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                            {t.events.filter(evt => {
                              if (evt.event === 'tool_start' || evt.event === 'tool_result') {
                                return shouldShowTool(evt.data?.tool || '')
                              }
                              return true
                            }).map((evt, idx) => {
                              const isToolStart = evt.event === 'tool_start'
                              const isToolResult = evt.event === 'tool_result'
                              const isAutoAssign = evt.event === 'auto_assign_start'
                              const isAutoAssigned = evt.event === 'auto_assigned'
                              const isAiAnalysisStart = evt.event === 'ai_analysis_start'
                              const isAiAnalysisDone = evt.event === 'ai_analysis_done'
                              const isAgentStart = evt.event === 'agent_start'
                              const isAgentDone = evt.event === 'agent_done'
                              const isTaskStart = evt.event === 'task_start'
                              const isTaskCompleted = evt.event === 'task_completed'
                              const isTaskFailed = evt.event === 'task_failed'
                              const isSequential = evt.event === 'sequential_step'
                              const isParallelStart = evt.event === 'parallel_start'
                              const isParallelDone = evt.event === 'parallel_done'
                              const isDebate = evt.event === 'debate_round'
                              const isThink = evt.event === 'think'

                              let icon = <div className="w-3.5 h-3.5 rounded-full bg-bg-tertiary border-2 border-text-dim/40" />
                              let title = evt.event
                              let desc = ''
                              let colorClass = 'text-text-muted'

                              if (isAutoAssign) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-blue-500" />
                                title = 'AI 分配任务'
                                desc = `候选 Agent: ${evt.data?.candidates?.join(', ') || '-'}`
                                colorClass = 'text-blue-600 dark:text-blue-400'
                              } else if (isAiAnalysisStart) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-purple-500 animate-pulse" />
                                title = 'AI 分析任务'
                                desc = evt.data?.title ? `任务: ${evt.data.title}` : '正在分析任务...'
                                colorClass = 'text-purple-600 dark:text-purple-400'
                              } else if (isAiAnalysisDone) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-purple-500" />
                                title = '任务分析完成'
                                const kws = evt.data?.keywords?.slice(0, 4)?.join(', ')
                                desc = `分类: ${evt.data?.category || '-'}${kws ? ` | 关键词: ${kws}` : ''}`
                                colorClass = 'text-purple-600 dark:text-purple-400'
                              } else if (isAutoAssigned) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-accent" />
                                title = '任务分配'
                                const wfMode = evt.data?.workflow_mode
                                const wfName = wfMode ? getModeName(wfMode) : ''
                                desc = `${evt.data?.strategy || '-'} → ${wfName || '单 Agent'}: ${evt.data?.agent || '-'}`
                                if (evt.data?.workflow_reason) {
                                  desc += `\n原因: ${evt.data.workflow_reason}`
                                }
                                colorClass = 'text-accent'
                              } else if (isTaskStart) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-blue-500" />
                                title = '任务开始'
                                colorClass = 'text-blue-600 dark:text-blue-400'
                              } else if (isAgentStart) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-yellow-500" />
                                title = `${evt.data?.agent || 'Agent'} 开始执行`
                                desc = `模型: ${evt.data?.model || '-'}`
                                colorClass = 'text-yellow-600 dark:text-yellow-400'
                              } else if (isToolStart) {
                                icon = <Wrench size={14} className="text-purple-500" />
                                title = `调用工具: ${evt.data?.tool || '-'}`
                                desc = getToolSummary(evt.data?.args, evt.data?.tool || '') || evt.data?.summary || ''
                                colorClass = 'text-purple-600 dark:text-purple-400'
                              } else if (isToolResult) {
                                icon = <CheckCircle2 size={14} className="text-green-500" />
                                title = `工具完成: ${evt.data?.tool || '-'}`
                                desc = evt.data?.result_preview ? `${safeSlice(evt.data.result_preview, 100)}${evt.data.result_preview.length > 100 ? '…' : ''}` : ''
                                colorClass = 'text-green-600 dark:text-green-400'
                              } else if (isAgentDone) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                                title = `${evt.data?.agent || 'Agent'} 执行完成`
                                desc = `结果长度: ${evt.data?.length || 0} 字符`
                                colorClass = 'text-green-600 dark:text-green-400'
                              } else if (isTaskCompleted) {
                                icon = <CheckCircle2 size={14} className="text-green-500" />
                                title = '任务完成'
                                colorClass = 'text-green-600 dark:text-green-400'
                              } else if (isTaskFailed) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-red-500" />
                                title = '任务失败'
                                desc = evt.data?.error || ''
                                colorClass = 'text-red-600 dark:text-red-400'
                              } else if (isSequential) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-blue-400" />
                                title = `串行步骤 ${evt.data?.step}/${evt.data?.total}`
                                desc = evt.data?.agent || ''
                                colorClass = 'text-blue-600 dark:text-blue-400'
                              } else if (isParallelStart) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-cyan-500" />
                                title = '并行执行开始'
                                desc = `${evt.data?.count || 0} 个 Agent 并行`
                                colorClass = 'text-cyan-600 dark:text-cyan-400'
                              } else if (isParallelDone) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                                title = '并行执行完成'
                                colorClass = 'text-green-600 dark:text-green-400'
                              } else if (isDebate) {
                                icon = <div className="w-3.5 h-3.5 rounded-full bg-orange-500" />
                                title = `辩论第 ${evt.data?.round || 0} 轮`
                                desc = evt.data?.agent || ''
                                colorClass = 'text-orange-600 dark:text-orange-400'
                              } else if (isThink) {
                                icon = <Brain size={14} className="text-purple-500" />
                                title = 'AI 思考中...'
                                colorClass = 'text-purple-600 dark:text-purple-400'
                              }

                              return (
                                <div key={idx} className="relative pl-6 pb-3 last:pb-0">
                                  <div className="absolute left-0 top-0.5">
                                    {icon}
                                  </div>
                                  <div className="text-xs">
                                    <span className={`font-medium ${colorClass}`}>{title}</span>
                                    {desc && (
                                      <p className="text-text-dim mt-0.5 break-words whitespace-pre-wrap">{desc}</p>
                                    )}
                                    {evt.data?.args && isToolStart && Object.keys(evt.data.args).length > 0 && (
                                      <div className="mt-1">
                                        {(() => {
                                          const key = `${t.id}-args-${idx}`
                                          const expanded = expandedToolArgs[key]
                                          const formatted = formatToolArgs(evt.data.args)
                                          const hasMore = JSON.stringify(evt.data.args).length > 200
                                          return (
                                            <>
                                              <div className={`bg-bg-secondary/60 rounded p-2 text-[10px] font-mono text-text-muted break-all whitespace-pre-wrap ${expanded ? '' : 'max-h-[80px] overflow-hidden'}`}>
                                                {formatted}
                                              </div>
                                              {hasMore && (
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); toggleToolArgs(t.id, idx) }}
                                                  className="mt-1 text-[10px] text-text-dim hover:text-text-primary flex items-center gap-0.5"
                                                >
                                                  {expanded ? <>收起 <ChevronDown size={10} /></> : <>展开详情 <ChevronRight size={10} /></>}
                                                </button>
                                              )}
                                            </>
                                          )
                                        })()}
                                      </div>
                                    )}
                                    {evt.data?.result_preview && isToolResult && evt.data.result_preview.length > 100 && (
                                      <div className="mt-1">
                                        {(() => {
                                          const key = `${t.id}-result-${idx}`
                                          const expanded = expandedToolResult[key]
                                          return (
                                            <>
                                              {expanded && (
                                                <div className="bg-green-500/5 border border-green-500/20 rounded p-2 text-[10px] font-mono text-text-muted break-all whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                                                  {evt.data.result_preview}
                                                </div>
                                              )}
                                              <button
                                                onClick={(e) => { e.stopPropagation(); toggleToolResult(t.id, idx) }}
                                                className="mt-1 text-[10px] text-green-600 dark:text-green-400 hover:underline flex items-center gap-0.5"
                                              >
                                                {expanded ? <>收起结果 <ChevronDown size={10} /></> : <>查看完整结果 <ChevronRight size={10} /></>}
                                              </button>
                                            </>
                                          )
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 产出文件 */}
                    {t.output_files && t.output_files.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs text-text-muted font-medium mb-2 flex items-center gap-1">
                          <FileText size={12} /> 产出文件 ({t.output_files.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {t.output_files.map((f, i) => (
                            <div key={i} className="inline-flex items-center gap-1 rounded-lg bg-green-500/10 border border-green-500/30 overflow-hidden">
                              <button onClick={() => window.open(ideApi.downloadUrl(f.path), '_blank')} className="p-1 text-green-600 dark:text-green-400 hover:bg-green-500/20" title="预览">
                                <Eye size={11} />
                              </button>
                              <span className="text-[10px] text-green-700 dark:text-green-500 px-1 truncate max-w-[120px]">{f.name}</span>
                              <a href={ideApi.downloadUrl(f.path)} download={f.name}
                                className="p-1 text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                title="下载">
                                <Download size={11} />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 完整结果 - Markdown 渲染 */}
                    {t.result && (
                      <div className="mb-3">
                        <div className="text-xs text-text-muted font-medium mb-2 flex items-center gap-2">
                          <FileText size={12} /> 执行结果
                          <span className="text-text-dim">({t.result.length} 字符)</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(t.result || '') }}
                            className="ml-auto px-1.5 py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary text-[11px]"
                            title="复制全文"
                          >
                            复制
                          </button>
                        </div>
                        <div className="prose prose-sm max-w-none bg-bg-tertiary rounded-lg p-4 overflow-y-auto max-h-[400px] text-text-primary break-words">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {t.result}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                    {t.error && (
                      <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded p-3">{t.error}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
