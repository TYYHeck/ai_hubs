import { useState, useEffect } from 'react'
import { Bot, Plus, Trash2, Edit3, Zap, Tag, Code, Save, X } from 'lucide-react'
import { api } from '../api/client'

interface AgentData {
  id: number
  name: string
  description: string
  system_prompt: string | null
  model: string
  provider: string
  skills: string[]
  tags: string[]
  category: string
  enable_planning: boolean
  enable_rag: boolean
  enable_reflection: boolean
  max_iterations: number
  memory_strength: number
  setup_mode: string
  status: string
  created_at: string | null
}

const defaultForm = {
  name: '', description: '', system_prompt: '', model: 'deepseek-chat',
  provider: 'deepseek', skills: '', tags: '', category: 'general',
  enable_planning: false, enable_rag: true, enable_reflection: false,
  max_iterations: 15, memory_strength: 3, setup_mode: 'detailed',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [error, setError] = useState('')

  const fetchAgents = async () => {
    try {
      const res = await api.get<{ data: AgentData[] }>('/agents')
      setAgents(res.data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { fetchAgents() }, [])

  const resetForm = () => {
    setForm(defaultForm)
    setEditingId(null)
    setShowForm(false)
    setError('')
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('名称不能为空'); return }
    try {
      const payload = {
        ...form,
        skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      }
      if (editingId) {
        await api.put(`/agents/${editingId}`, payload)
      } else {
        await api.post('/agents', payload)
      }
      resetForm()
      fetchAgents()
    } catch (e: any) {
      setError(e.response?.data?.detail || '操作失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此 Agent？')) return
    await api.delete(`/agents/${id}`)
    fetchAgents()
  }

  const startEdit = (a: AgentData) => {
    setForm({
      name: a.name, description: a.description, system_prompt: a.system_prompt || '',
      model: a.model, provider: a.provider,
      skills: a.skills.join(', '), tags: a.tags.join(', '), category: a.category,
      enable_planning: a.enable_planning, enable_rag: a.enable_rag,
      enable_reflection: a.enable_reflection,
      max_iterations: a.max_iterations, memory_strength: a.memory_strength,
      setup_mode: a.setup_mode,
    })
    setEditingId(a.id)
    setShowForm(true)
  }

  const modeLabel = (m: string) => m === 'quick' ? '快速' : '详细'
  const strengthColor = (s: number) => s >= 4 ? 'text-green-400' : s >= 2 ? 'text-yellow-400' : 'text-gray-400'

  if (loading) return <div className="p-8 text-gray-400">加载中...</div>

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Bot size={22} className="text-blue-400" />
          <h1 className="text-lg font-semibold text-white">Agent 管理</h1>
          <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">{agents.length} 个</span>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm transition-colors">
          <Plus size={16} /> 新建 Agent
        </button>
      </div>

      {/* 错误 */}
      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {/* 表单 */}
      {showForm && (
        <div className="mx-6 mt-4 bg-white/[0.03] border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">{editingId ? '编辑 Agent' : '新建 Agent'}</h3>
            <button onClick={resetForm} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">名称 *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="Agent 名称" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">分类</label>
              <input value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="general" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">描述</label>
              <input value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="简单描述 Agent 的用途" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">模型</label>
              <select value={form.model} onChange={e => setForm({...form, model: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none">
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="glm-4">GLM-4</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">配置模式</label>
              <select value={form.setup_mode} onChange={e => setForm({...form, setup_mode: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none">
                <option value="quick">快速</option>
                <option value="detailed">详细</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">System Prompt</label>
              <textarea value={form.system_prompt} onChange={e => setForm({...form, system_prompt: e.target.value})} rows={3}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none resize-none"
                placeholder="定义 Agent 的角色和行为..." />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">技能 (逗号分隔)</label>
              <input value={form.skills} onChange={e => setForm({...form, skills: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="python, typescript" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">标签 (逗号分隔)</label>
              <input value={form.tags} onChange={e => setForm({...form, tags: e.target.value})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="coding, assistant" />
            </div>
          </div>
          {/* 开关组 */}
          <div className="flex gap-6 mt-4">
            {(['enable_planning', 'enable_rag', 'enable_reflection'] as const).map(key => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                <input type="checkbox" checked={form[key]} onChange={e => setForm({...form, [key]: e.target.checked})}
                  className="rounded bg-white/10 border-white/20 text-blue-500 focus:ring-blue-500" />
                {key === 'enable_planning' ? '规划' : key === 'enable_rag' ? 'RAG' : '反思'}
              </label>
            ))}
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>记忆强度</span>
              <input type="range" min="0" max="5" step="0.5" value={form.memory_strength}
                onChange={e => setForm({...form, memory_strength: parseFloat(e.target.value)})} className="w-20" />
              <span className={strengthColor(form.memory_strength)}>{form.memory_strength}</span>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleSubmit}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm transition-colors">
              <Save size={14} /> {editingId ? '更新' : '创建'}
            </button>
            <button onClick={resetForm}
              className="text-gray-400 hover:text-white px-4 py-2 text-sm transition-colors">取消</button>
          </div>
        </div>
      )}

      {/* Agent 列表 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {agents.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <Bot size={48} className="mx-auto mb-4 opacity-30" />
            <p>还没有 Agent，点击上方按钮创建第一个</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {agents.map(a => (
              <div key={a.id} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-medium truncate">{a.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{modeLabel(a.setup_mode)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{a.model}</span>
                    </div>
                    <p className="text-gray-500 text-sm truncate">{a.description || '无描述'}</p>
                    {a.system_prompt && (
                      <p className="text-gray-600 text-xs mt-1 truncate italic">"{a.system_prompt.slice(0, 100)}"</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {a.tags.map((t, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 flex items-center gap-1">
                          <Tag size={10} />{t}
                        </span>
                      ))}
                      {a.skills.slice(0, 3).map((s, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                          <Code size={10} />{s}
                        </span>
                      ))}
                      {a.skills.length > 3 && (
                        <span className="text-[10px] text-gray-500">+{a.skills.length - 3}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button onClick={() => startEdit(a)} className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-white/5 rounded-lg transition-colors">
                      <Edit3 size={15} />
                    </button>
                    <button onClick={() => handleDelete(a.id)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
