import { useState, useEffect, useRef } from 'react'
import { Workflow, Plus, Play, Pause, RotateCw, Trash2, X, ChevronRight, ChevronDown, FileText, Circle, GitBranch, CheckCircle, AlertCircle, Settings, Sparkles, ArrowRight, Zap, Brain, Layers, MessageSquare, Code2, FileCode, Plus as PlusIcon, Minus, Edit3, Save, Wand2, EyeOff } from 'lucide-react'
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
  enabled?: boolean
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
    id: 'blank',
    name: '空模板',
    description: '从零开始构建你的工作流',
    icon: <PlusIcon size={20} />,
    nodes: [
      { id: 'start', type: 'start', label: '开始', next: ['end'] },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { from: 'start', to: 'end' },
    ],
  },
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ name: '', description: '', templateId: 'simple' })
  const [submitting, setSubmitting] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [editingWf, setEditingWf] = useState<WorkflowData | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Array<{ id: number; name: string }>>([])
  const [createMode, setCreateMode] = useState<'template' | 'ai'>('template')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiGeneratedWf, setAiGeneratedWf] = useState<{ nodes: WorkflowNode[]; edges: Array<{ from: string; to: string }> } | null>(null)

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
    loadAgents()
  }, [])

  const loadAgents = async () => {
    try {
      const r = await api.get<Array<{ id: number; name: string }>>('/agents')
      if (Array.isArray(r)) setAgents(r)
      else if (r && Array.isArray((r as any).items)) setAgents((r as any).items)
    } catch { /* ignore */ }
  }

  const resetForm = () => {
    setForm({ name: '', description: '', templateId: 'simple' })
    setShowForm(false)
    setShowTemplates(false)
    setError('')
    setCreateMode('template')
    setAiGeneratedWf(null)
    setAiGenerating(false)
  }

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('名称不能为空'); return }
    setSubmitting(true)
    try {
      let nodes, edges
      if (createMode === 'ai' && aiGeneratedWf) {
        nodes = aiGeneratedWf.nodes
        edges = aiGeneratedWf.edges
      } else {
        const template = builtinTemplates.find(t => t.id === form.templateId) || builtinTemplates[0]
        nodes = JSON.parse(JSON.stringify(template.nodes))
        edges = JSON.parse(JSON.stringify(template.edges || []))
      }
      await api.post('/workflows', {
        name: form.name,
        description: form.description,
        nodes,
        edges,
      })
      resetForm()
      fetchWorkflows()
      setMsg('创建成功')
    } catch (e: any) {
      setError(e.response?.data?.detail || '创建失败')
    }
    setSubmitting(false)
  }

  const generateWorkflow = async () => {
    if (!form.name.trim() && !form.description.trim()) {
      setError('请输入工作流名称或描述')
      return
    }
    setAiGenerating(true); setError(''); setAiGeneratedWf(null)
    try {
      const r = await api.post<{ nodes: WorkflowNode[]; edges: Array<{ from: string; to: string }> }>('/workflows/ai/generate', {
        name: form.name,
        description: form.description,
      })
      setAiGeneratedWf(r)
    } catch (e: any) {
      setError(e.response?.data?.detail || '生成失败')
    } finally {
      setAiGenerating(false)
    }
  }

  const handleToggle = async (id: string) => {
    try {
      await api.post(`/workflows/${id}/toggle`)
      fetchWorkflows()
    } catch (e) {
      setError((e as Error)?.message || '操作失败')
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

  // ── 工作流编辑器 ──
  const startEdit = (wf: WorkflowData) => {
    setEditingWf(JSON.parse(JSON.stringify(wf)))
    setSelectedNodeId(null)
  }

  const cancelEdit = () => {
    setEditingWf(null)
    setSelectedNodeId(null)
  }

  const saveEdit = async () => {
    if (!editingWf) return
    try {
      await api.put(`/workflows/${editingWf.id}`, {
        name: editingWf.name,
        description: editingWf.description,
        nodes: editingWf.nodes,
        edges: editingWf.edges,
      })
      setMsg('保存成功')
      setEditingWf(null)
      setSelectedNodeId(null)
      fetchWorkflows()
    } catch (e: any) {
      setError(e.response?.data?.detail || '保存失败')
    }
  }

  const addNodeAfter = (afterId: string, type: WorkflowNode['type']) => {
    if (!editingWf) return
    const newId = `${type}_${Date.now()}`
    const labels: Record<string, string> = {
      agent: '新 Agent',
      tool: '新工具',
      condition: '条件判断',
      parallel: '并行执行',
      sequential: '串行执行',
    }
    const newNode: WorkflowNode = {
      id: newId,
      type,
      label: labels[type] || '新节点',
      next: [],
    }

    const nodes = [...editingWf.nodes]
    const afterIdx = nodes.findIndex(n => n.id === afterId)
    if (afterIdx === -1) return

    // 更新前一个节点的 next 指向新节点
    const oldNext = nodes[afterIdx].next || []
    nodes[afterIdx] = { ...nodes[afterIdx], next: [newId] }

    // 新节点的 next 指向下一个节点
    const nextIds = oldNext.filter(id => id !== 'end')
    newNode.next = nextIds.length > 0 ? nextIds : ['end']

    // 插入新节点
    nodes.splice(afterIdx + 1, 0, newNode)

    // 重建 edges
    const edges: Array<{ from: string; to: string }> = []
    nodes.forEach(n => {
      (n.next || []).forEach(nextId => {
        edges.push({ from: n.id, to: nextId })
      })
    })

    setEditingWf({ ...editingWf, nodes, edges })
    setSelectedNodeId(newId)
  }

  const deleteNode = (nodeId: string) => {
    if (!editingWf) return
    const nodes = [...editingWf.nodes]
    const idx = nodes.findIndex(n => n.id === nodeId)
    if (idx === -1) return
    const node = nodes[idx]
    if (node.type === 'start' || node.type === 'end') return

    // 找到前一个节点，把它的 next 指向当前节点的 next
    const prevNode = nodes.find(n => n.next?.includes(nodeId))
    if (prevNode) {
      const prevIdx = nodes.findIndex(n => n.id === prevNode.id)
      const newNext = (prevNode.next || []).filter(id => id !== nodeId)
      const currentNext = node.next || []
      nodes[prevIdx] = { ...prevNode, next: [...newNext, ...currentNext] }
    }

    // 删除节点
    nodes.splice(idx, 1)

    // 重建 edges
    const edges: Array<{ from: string; to: string }> = []
    nodes.forEach(n => {
      (n.next || []).forEach(nextId => {
        edges.push({ from: n.id, to: nextId })
      })
    })

    setEditingWf({ ...editingWf, nodes, edges })
    setSelectedNodeId(null)
  }

  const updateNode = (nodeId: string, updates: Partial<WorkflowNode>) => {
    if (!editingWf) return
    const nodes = editingWf.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n)
    setEditingWf({ ...editingWf, nodes })
  }

  const nodeTypes: Array<{ type: WorkflowNode['type']; label: string; icon: JSX.Element }> = [
    { type: 'agent', label: 'Agent 节点', icon: <Sparkles size={12} /> },
    { type: 'tool', label: '工具节点', icon: <FileText size={12} /> },
    { type: 'condition', label: '条件分支', icon: <GitBranch size={12} /> },
    { type: 'parallel', label: '并行执行', icon: <Layers size={12} /> },
  ]

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

          {/* 模式切换 */}
          <div className="flex gap-2 mb-4 bg-bg-tertiary p-1 rounded-lg">
            <button onClick={() => setCreateMode('template')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-all ${
                createMode === 'template' ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}>
              <Layers size={14} /> 从模板创建
            </button>
            <button onClick={() => setCreateMode('ai')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-all ${
                createMode === 'ai' ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}>
              <Wand2 size={14} /> AI 智能生成
            </button>
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
                placeholder={createMode === 'ai' ? '描述你想要的工作流功能，越详细生成越准确...' : '描述此工作流的用途...'} />
            </div>

            {createMode === 'template' ? (
              <>
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
              </>
            ) : (
              <>
                {/* AI 生成模式 */}
                <div className="bg-bg-tertiary rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-text-muted flex items-center gap-1">
                      <Wand2 size={12} className="text-amber-500" /> AI 智能设计工作流
                    </div>
                    <button onClick={generateWorkflow} disabled={aiGenerating}
                      className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent hover:bg-accent hover:text-white text-[10px] rounded transition-colors disabled:opacity-50">
                      {aiGenerating ? (
                        <>
                          <RotateCw size={10} className="animate-spin" /> 生成中...
                        </>
                      ) : (
                        <>
                          <Sparkles size={10} /> 生成工作流
                        </>
                      )}
                    </button>
                  </div>

                  {aiGeneratedWf ? (
                    <div>
                      <div className="text-[10px] text-green-600 dark:text-green-400 mb-2 flex items-center gap-1">
                        <CheckCircle size={10} /> 生成完成，共 {aiGeneratedWf.nodes.length} 个节点
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {aiGeneratedWf.nodes.map((node, i) => (
                          <div key={node.id} className="flex items-center gap-1">
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${nodeColors[node.type as keyof typeof nodeColors]}`}>
                              {nodeIcons[node.type as keyof typeof nodeIcons]}
                              <span>{node.label}</span>
                            </div>
                            {i < aiGeneratedWf.nodes.length - 1 && (
                              <ArrowRight size={10} className="text-text-dim" />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={generateWorkflow} disabled={aiGenerating}
                          className="text-[10px] text-accent hover:underline disabled:opacity-50">
                          重新生成
                        </button>
                        <span className="text-[10px] text-text-dim">不满意可以重新生成，或创建后在编辑器中调整</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-text-dim text-center py-3">
                      {aiGenerating ? (
                        <div className="flex items-center justify-center gap-2">
                          <RotateCw size={12} className="animate-spin text-accent" />
                          <span>AI 正在为你设计工作流...</span>
                        </div>
                      ) : (
                        <div>输入名称和描述后，点击「生成工作流」让 AI 自动设计</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleCreate} disabled={submitting || (createMode === 'ai' && !aiGeneratedWf)}
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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        wf.enabled !== false ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                        'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                      }`}>
                        {wf.enabled !== false ? '已启用' : '未启用'}
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
                    <button onClick={() => handleToggle(wf.id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        wf.enabled !== false
                          ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-bg-tertiary'
                          : 'text-green-600 dark:text-green-400 hover:bg-green-500/10'
                      }`}
                      title={wf.enabled !== false ? '停用（从任务选取中隐藏）' : '启用（可在任务创建时选取运行）'}>
                      {wf.enabled !== false ? <EyeOff size={15} /> : <Play size={15} />}
                    </button>
                    <button onClick={() => { startEdit(wf); setExpandedId(wf.id) }}
                      className="p-1.5 text-text-muted hover:text-accent hover:bg-bg-tertiary rounded-lg transition-colors" title="编辑">
                      <Edit3 size={15} />
                    </button>
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
                    {editingWf && editingWf.id === wf.id ? (
                      <>
                        {/* 编辑模式 */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Edit3 size={14} className="text-accent" />
                            <span className="text-sm font-medium text-text-primary">编辑工作流</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={cancelEdit}
                              className="px-3 py-1 text-xs text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors">
                              取消
                            </button>
                            <button onClick={saveEdit}
                              className="px-3 py-1 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors flex items-center gap-1">
                              <Save size={12} /> 保存
                            </button>
                          </div>
                        </div>

                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div>
                            <label className="block text-[10px] text-text-muted mb-1">名称</label>
                            <input value={editingWf.name}
                              onChange={e => setEditingWf({ ...editingWf, name: e.target.value })}
                              className="w-full bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-text-muted mb-1">描述</label>
                            <input value={editingWf.description}
                              onChange={e => setEditingWf({ ...editingWf, description: e.target.value })}
                              className="w-full bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none" />
                          </div>
                        </div>

                        {/* 流程图编辑器 */}
                        <div className="text-[10px] text-text-muted font-medium mb-2 flex items-center gap-1">
                          <Workflow size={12} /> 流程节点
                        </div>
                        <div className="bg-bg-tertiary rounded-lg p-3 min-h-[100px] space-y-2">
                          {editingWf.nodes.map(node => (
                            <div key={node.id} className="flex items-center gap-2">
                              <div
                                onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                                className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${
                                  selectedNodeId === node.id
                                    ? 'ring-2 ring-accent/50 bg-bg-secondary'
                                    : 'hover:bg-bg-secondary'
                                }`}>
                                <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${nodeColors[node.type]}`}>
                                  {nodeIcons[node.type]}
                                  <span>{node.label}</span>
                                </div>
                                {node.type === 'agent' && node.agent_id && (
                                  <span className="text-[10px] text-text-dim">
                                    Agent: {agents.find(a => a.id === node.agent_id)?.name || node.agent_id}
                                  </span>
                                )}
                              </div>
                              {node.type !== 'end' && (
                                <div className="relative group">
                                  <button onClick={e => { e.stopPropagation(); }}
                                    className="p-1 text-text-muted hover:text-accent hover:bg-bg-secondary rounded transition-colors">
                                    <PlusIcon size={12} />
                                  </button>
                                  <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-border rounded-lg p-1.5 z-10 hidden group-hover:block min-w-[120px] shadow-lg">
                                    <div className="text-[10px] text-text-muted mb-1 px-1">添加节点</div>
                                    {nodeTypes.map(nt => (
                                      <button key={nt.type}
                                        onClick={e => { e.stopPropagation(); addNodeAfter(node.id, nt.type) }}
                                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-tertiary text-left">
                                        {nt.icon} {nt.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {node.type !== 'start' && node.type !== 'end' && (
                                <button onClick={e => { e.stopPropagation(); deleteNode(node.id) }}
                                  className="p-1 text-text-muted hover:text-red-500 hover:bg-bg-secondary rounded transition-colors"
                                  title="删除节点">
                                  <Minus size={12} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* 节点配置面板 */}
                        {selectedNodeId && (() => {
                          const node = editingWf.nodes.find(n => n.id === selectedNodeId)
                          if (!node) return null
                          return (
                            <div className="mt-3 bg-bg-tertiary rounded-lg p-3">
                              <div className="text-[10px] text-text-muted font-medium mb-2 flex items-center gap-1">
                                <Settings size={12} /> 节点配置: {node.label}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] text-text-muted mb-1">节点名称</label>
                                  <input value={node.label}
                                    onChange={e => updateNode(node.id, { label: e.target.value })}
                                    className="w-full bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none" />
                                </div>
                                {node.type === 'agent' && (
                                  <div>
                                    <label className="block text-[10px] text-text-muted mb-1">选择 Agent</label>
                                    <select value={node.agent_id || ''}
                                      onChange={e => updateNode(node.id, { agent_id: e.target.value ? Number(e.target.value) : undefined })}
                                      className="w-full bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none">
                                      <option value="">（自动分配）</option>
                                      {agents.map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                {node.type === 'tool' && (
                                  <div>
                                    <label className="block text-[10px] text-text-muted mb-1">工具名称</label>
                                    <input value={node.tool_name || ''}
                                      onChange={e => updateNode(node.id, { tool_name: e.target.value })}
                                      placeholder="如: run_code, write_file"
                                      className="w-full bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none" />
                                  </div>
                                )}
                                {node.type === 'condition' && (
                                  <div className="col-span-2">
                                    <label className="block text-[10px] text-text-muted mb-1">条件表达式</label>
                                    <input value={node.condition || ''}
                                      onChange={e => updateNode(node.id, { condition: e.target.value })}
                                      placeholder="如: 包含'代码'则走分支A"
                                      className="w-full bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary focus:border-accent outline-none" />
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })()}
                      </>
                    ) : (
                      <>
                        {/* 查看模式 */}
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
                      </>
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
