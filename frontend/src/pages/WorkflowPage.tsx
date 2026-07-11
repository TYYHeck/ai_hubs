import { useState, useEffect, useRef } from 'react'
import { Workflow, Plus, Play, Pause, RotateCw, Trash2, X, ChevronRight, ChevronDown, FileText, Circle, GitBranch, CheckCircle, AlertCircle, Settings, Sparkles, ArrowRight, Zap, Brain, Layers, MessageSquare, Code2, FileCode } from 'lucide-react'
import { api } from '../api/client'

interface WorkflowNode {
  id: string
  type: 'start' | 'agent' | 'tool' | 'condition' | 'end' | 'parallel' | 'sequential'
  label: string
  agent_id?: number
  tool_name?: string
  next?: string[]
  condition?: string
}

interface WorkflowData {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: { from: string; to: string }[]
  status: string
  created_at: string
  updated_at: string
}

const nodeColors: Record<string, string> = {
  start: 'bg-blue-500 text-white',
  agent: 'bg-purple-500 text-white',
  tool: 'bg-green-500 text-white',
  condition: 'bg-amber-500 text-white',
  end: 'bg-red-500 text-white',
  parallel: 'bg-cyan-500 text-white',
  sequential: 'bg-indigo-500 text-white',
}

const nodeIcons: Record<string, JSX.Element> = {
  start: <Circle size={12} />,
  agent: <Sparkles size={12} />,
  tool: <FileText size={12} />,
  condition: <GitBranch size={12} />,
  end: <CheckCircle size={12} />,
  parallel: <Circle size={12} />,
  sequential: <ArrowRight size={12} />,
}

interface WorkflowTemplate {
  id: string
  name: string
  description: string
  icon: JSX.Element
  nodes: WorkflowNode[]
  edges: { from: string; to: string }[]
}

const builtinTemplates: WorkflowTemplate[] = [
  {
    id: 'simple',
    name: '单 Agent 模式',
    description: '最简单的工作流，一个 Agent 处理所有任务',
    icon: <Zap size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['agent1'] },
      { id: 'agent1', type: 'agent', label: '默认 Agent', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'agent1' },
      { from: 'agent1', to: 'end' },
    ],
  },
  {
    id: 'sequential',
    name: '串行协作',
    description: '多个 Agent 按顺序依次处理，前一个的输出作为后一个的输入',
    icon: <ArrowRight size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['agent1'] },
      { id: 'agent1', type: 'agent', label: '分析 Agent', next: ['agent2'] },
      { id: 'agent2', type: 'agent', label: '执行 Agent', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'agent1' },
      { from: 'agent1', to: 'agent2' },
      { from: 'agent2', to: 'end' },
    ],
  },
  {
    id: 'parallel',
    name: '并行协作',
    description: '多个 Agent 同时并行处理任务，最后汇总结果',
    icon: <Layers size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['parallel1'] },
      { id: 'parallel1', type: 'parallel', label: '并行执行', next: ['agent1', 'agent2', 'agent3'] },
      { id: 'agent1', type: 'agent', label: 'Agent A', next: ['end'] },
      { id: 'agent2', type: 'agent', label: 'Agent B', next: ['end'] },
      { id: 'agent3', type: 'agent', label: 'Agent C', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'parallel1' },
      { from: 'parallel1', to: 'agent1' },
      { from: 'parallel1', to: 'agent2' },
      { from: 'parallel1', to: 'agent3' },
      { from: 'agent1', to: 'end' },
      { from: 'agent2', to: 'end' },
      { from: 'agent3', to: 'end' },
    ],
  },
  {
    id: 'debate',
    name: '辩论模式',
    description: '正反双方 Agent 辩论，最后由裁判 Agent 做出决策',
    icon: <MessageSquare size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['pro'] },
      { id: 'pro', type: 'agent', label: '正方 Agent', next: ['con'] },
      { id: 'con', type: 'agent', label: '反方 Agent', next: ['judge'] },
      { id: 'judge', type: 'agent', label: '裁判 Agent', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'pro' },
      { from: 'pro', to: 'con' },
      { from: 'con', to: 'judge' },
      { from: 'judge', to: 'end' },
    ],
  },
  {
    id: 'code_review',
    name: '代码审查',
    description: '专门用于代码审查的工作流：分析 → 审查 → 总结',
    icon: <Code2 size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['analyze'] },
      { id: 'analyze', type: 'agent', label: '代码分析', next: ['review'] },
      { id: 'review', type: 'agent', label: '代码审查', next: ['summary'] },
      { id: 'summary', type: 'agent', label: '报告生成', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'analyze' },
      { from: 'analyze', to: 'review' },
      { from: 'review', to: 'summary' },
      { from: 'summary', to: 'end' },
    ],
  },
  {
    id: 'auto_assign',
    name: 'AI 智能分配',
    description: 'AI 自动分析任务并分配给最合适的 Agent',
    icon: <Brain size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['analyzer'] },
      { id: 'analyzer', type: 'agent', label: 'AI 分析器', next: ['condition'] },
      { id: 'condition', type: 'condition', label: '任务类型判断', next: ['agent1', 'agent2', 'agent3'] },
      { id: 'agent1', type: 'agent', label: '代码 Agent', next: ['end'] },
      { id: 'agent2', type: 'agent', label: '文档 Agent', next: ['end'] },
      { id: 'agent3', type: 'agent', label: '通用 Agent', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'analyzer' },
      { from: 'analyzer', to: 'condition' },
      { from: 'condition', to: 'agent1' },
      { from: 'condition', to: 'agent2' },
      { from: 'condition', to: 'agent3' },
      { from: 'agent1', to: 'end' },
      { from: 'agent2', to: 'end' },
      { from: 'agent3', to: 'end' },
    ],
  },
]

export default function WorkflowPage() {
  const [workflows, setWorkflows] = useState<WorkflowData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ name: '', description: '', templateId: 'simple' })
  const [submitting, setSubmitting] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const fetchWorkflows = async () => {
    setLoading(true)
    try {
      const r = await api.get<WorkflowData[]>('/workflows')
      setWorkflows(r || [])
    } catch (e) {
      setError((e as Error)?.message || '加载失败')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchWorkflows()
  }, [])

  const resetForm = () => {
    setForm({ name: '', description: '', templateId: 'simple' })
    setShowForm(false)
    setShowTemplates(false)
    setError('')
  }

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('名称不能为空'); return }
    const template = builtinTemplates.find(t => t.id === form.templateId) || builtinTemplates[0]
    setSubmitting(true)
    try {
      await api.post('/workflows', {
        name: form.name,
        description: form.description,
        nodes: template.nodes,
        edges: template.edges,
      })
      resetForm()
      fetchWorkflows()
      setMsg('创建成功')
    } catch (e: any) {
      setError(e.response?.data?.detail || '创建失败')
    }
    setSubmitting(false)
  }

  const handleExecute = async (id: string) => {
    try {
      await api.post(`/workflows/${id}/execute`)
      fetchWorkflows()
    } catch (e) {
      setError((e as Error)?.message || '执行失败')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此工作流？')) return
    try {
      await api.delete(`/workflows/${id}`)
      fetchWorkflows()
      setMsg('删除成功')
    } catch (e) {
      setError((e as Error)?.message || '删除失败')
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Workflow size={22} className="text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">工作流</h1>
          <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded">{workflows.length} 个工作流</span>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm transition-colors">
          <Plus size={16} /> 新建工作流
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}
      {msg && (
        <div className="mx-6 mt-4 bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 px-4 py-2 rounded-lg text-sm" onClick={() => setMsg('')}>{msg}</div>
      )}

      {showForm && (
        <div className="mx-6 mt-4 bg-bg-secondary border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-text-primary font-medium">新建工作流</h3>
            <button onClick={resetForm} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">名称 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none"
                placeholder="工作流名称" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">描述</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:border-accent outline-none resize-none"
                placeholder="描述此工作流的用途..." />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-text-muted">选择模板</label>
                <button
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="text-xs text-accent hover:underline"
                >
                  {showTemplates ? '收起模板' : '查看全部模板'}
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(showTemplates ? builtinTemplates : builtinTemplates.slice(0, 4)).map(template => (
                  <button
                    key={template.id}
                    onClick={() => setForm({ ...form, templateId: template.id })}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      form.templateId === template.id
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-border bg-bg-tertiary hover:border-text-dim'
                    }`}
                  >
                    <div className={`mb-2 ${form.templateId === template.id ? 'text-accent' : 'text-text-muted'}`}>
                      {template.icon}
                    </div>
                    <div className="text-xs font-medium text-text-primary">{template.name}</div>
                    <div className="text-[10px] text-text-dim mt-0.5 line-clamp-2">{template.description}</div>
                  </button>
                ))}
              </div>
            </div>
            {/* 预览选中的模板流程 */}
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
                <Workflow size={12} /> 流程预览
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {builtinTemplates.find(t => t.id === form.templateId)?.nodes.map((node, i) => (
                  <div key={node.id} className="flex items-center gap-1">
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${nodeColors[node.type]}`}>
                      {nodeIcons[node.type]}
                      <span>{node.label}</span>
                    </div>
                    {i < (builtinTemplates.find(t => t.id === form.templateId)?.nodes.length || 0) - 1 && (
                      <ArrowRight size={10} className="text-text-dim" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleCreate} disabled={submitting}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm transition-colors">
              <Plus size={14} /> {submitting ? '创建中…' : '创建工作流'}
            </button>
            <button onClick={resetForm} className="text-text-muted hover:text-text-primary px-4 py-2 text-sm transition-colors">取消</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        {/* 内置工作流模板 */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-500" />
              <span className="text-sm font-medium text-text-primary">内置模板</span>
              <span className="text-[10px] text-text-dim bg-bg-tertiary px-1.5 py-0.5 rounded">{builtinTemplates.length} 个</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {builtinTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => { setForm({ name: template.name, description: template.description, templateId: template.id }); setShowForm(true) }}
                className="p-3 bg-bg-secondary border border-border rounded-xl text-left hover:border-accent/40 hover:bg-accent/5 transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-muted group-hover:bg-accent/10 group-hover:text-accent transition-colors mb-2">
                  {template.icon}
                </div>
                <div className="text-xs font-medium text-text-primary">{template.name}</div>
                <div className="text-[10px] text-text-dim mt-0.5 line-clamp-2">{template.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 自定义工作流列表 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Workflow size={14} className="text-accent" />
            <span className="text-sm font-medium text-text-primary">我的工作流</span>
            <span className="text-[10px] text-text-dim bg-bg-tertiary px-1.5 py-0.5 rounded">{workflows.length} 个</span>
          </div>
        </div>
        {loading ? (
          <div className="text-center text-text-muted mt-10">加载中…</div>
        ) : workflows.length === 0 ? (
          <div className="text-center text-text-muted py-10 bg-bg-secondary border border-dashed border-border rounded-xl">
            <Workflow size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">还没有自定义工作流</p>
            <p className="text-xs text-text-dim mt-1">点击上方模板快速创建，或点击「新建工作流」从零开始</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {workflows.map(wf => (
              <div key={wf.id}
                className={`bg-bg-secondary border rounded-xl overflow-hidden transition-colors ${
                  expandedId === wf.id ? 'border-accent/40' : 'border-border hover:border-text-dim'
                }`}>
                <div className="p-4 flex items-start justify-between cursor-pointer"
                  onClick={() => setExpandedId(expandedId === wf.id ? null : wf.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        wf.status === 'running' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                        wf.status === 'completed' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                        'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                      }`}>
                        {wf.status === 'running' ? '运行中' : wf.status === 'completed' ? '已完成' : '待运行'}
                      </span>
                      <span className="text-text-primary font-medium truncate">{wf.name}</span>
                    </div>
                    <p className="text-text-muted text-xs">{wf.description || '无描述'}</p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-text-dim">
                      <span>{wf.nodes.length} 个节点</span>
                      <span>{wf.edges.length} 条连线</span>
                      <span>{wf.created_at?.slice(0, 10) || '-'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3" onClick={e => e.stopPropagation()}>
                    {wf.status !== 'running' && (
                      <button onClick={() => handleExecute(wf.id)}
                        className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors" title="执行">
                        <Play size={15} />
                      </button>
                    )}
                    <button onClick={() => handleDelete(wf.id)}
                      className="p-1.5 text-text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-bg-tertiary rounded-lg transition-colors" title="删除">
                      <Trash2 size={15} />
                    </button>
                    <span className="text-text-dim ml-1">
                      {expandedId === wf.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </div>
                </div>

                {expandedId === wf.id && (
                  <div className="px-4 pb-4 border-t border-border pt-3">
                    <div className="text-xs text-text-muted font-medium mb-2 flex items-center gap-1">
                      <Workflow size={12} /> 流程图
                    </div>
                    <div className="bg-bg-tertiary rounded-lg p-4 min-h-[120px]">
                      <div className="flex flex-wrap items-center gap-2">
                        {wf.nodes.map(node => (
                          <div key={node.id} className="flex items-center gap-1">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded ${nodeColors[node.type]}`}>
                              {nodeIcons[node.type]}
                              <span className="text-[10px]">{node.label}</span>
                            </div>
                            {node.next?.length && (
                              <ArrowRight size={12} className="text-text-muted" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs text-text-muted font-medium mb-2 flex items-center gap-1">
                        <Settings size={12} /> 节点详情
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {wf.nodes.map(node => (
                          <div key={node.id} className="bg-bg-tertiary rounded p-2">
                            <div className={`flex items-center gap-1 mb-1 ${nodeColors[node.type]}`}>
                              {nodeIcons[node.type]}
                              <span className="text-[10px]">{node.label}</span>
                            </div>
                            <div className="text-[10px] text-text-muted">类型: {node.type}</div>
                            {node.agent_id && <div className="text-[10px] text-text-muted">Agent ID: {node.agent_id}</div>}
                            {node.tool_name && <div className="text-[10px] text-text-muted">工具: {node.tool_name}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
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
