import { useState, useEffect } from 'react'
import { Bot, Plus, Trash2, Edit3, Zap, Tag, Code, Save, X, Sparkles, Globe, User as UserIcon, Star, Loader2, Search } from 'lucide-react'
import { agentApi, skillApi, type Agent, type Skill } from '../api/client'

interface FormState {
  id?: number
  name: string
  description: string
  system_prompt: string
  model: string
  provider: string
  config_mode: 'global' | 'self'
  is_default: boolean
  skills: string[]
  tags: string[]
  category: string
  enable_planning: boolean
  enable_rag: boolean
  enable_reflection: boolean
  max_iterations: number
  memory_strength: number
  setup_mode: 'quick' | 'detailed'
  showPrompt: boolean
}

const defaultForm: FormState = {
  name: '', description: '', system_prompt: '', model: 'deepseek-chat',
  provider: 'deepseek', config_mode: 'global', is_default: false,
  skills: [], tags: [], category: 'general',
  enable_planning: false, enable_rag: true, enable_reflection: false,
  max_iterations: 15, memory_strength: 3, setup_mode: 'quick',
  showPrompt: false,
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  // 技能选择下拉状态
  const [skillSearch, setSkillSearch] = useState('')
  const [skillOpen, setSkillOpen] = useState(false)

  const fetchAgents = async () => {
    try {
      const res = await agentApi.list()
      setAgents(res ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }
  const fetchSkills = async () => {
    try {
      const res = await skillApi.list({ installed: true })
      setInstalledSkills(res ?? [])
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchAgents(); fetchSkills() }, [])

  const resetForm = () => {
    setForm(defaultForm)
    setEditingId(null)
    setShowForm(false)
    setError('')
    setSkillSearch('')
    setSkillOpen(false)
    setAnalyzing(false)
  }

  // 快速配置：调用 AI 分析并推荐技能/标签/分类，填充隐藏 prompt 草稿
  const runAnalyze = async () => {
    if (!form.name.trim() && !form.description.trim()) {
      setError('请先填写名称或描述，AI 才能分析')
      return
    }
    setAnalyzing(true)
    setError('')
    try {
      const res = await agentApi.analyze({
        name: form.name.trim(),
        description: form.description.trim(),
        available_skills: installedSkills.map(s => s.name),
      })
      if (res.ok) {
        setForm(f => ({
          ...f,
          system_prompt: res.system_prompt_draft || f.system_prompt,
          skills: res.suggested_skills.length ? res.suggested_skills : f.skills,
          tags: res.suggested_tags.length ? res.suggested_tags : f.tags,
          category: res.category || f.category,
          showPrompt: true, // AI 已生成草稿，展开隐藏的 prompt 填写界面供确认/微调
        }))
      }
    } catch (e: any) {
      setError(e?.message || 'AI 分析失败')
    }
    setAnalyzing(false)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('名称不能为空'); return }
    // 防重复：新建时本地比对同名 Agent
    if (!editingId && agents.some(a => a.name.toLowerCase() === form.name.trim().toLowerCase())) {
      setError(`已存在名为「${form.name.trim()}」的 Agent，请勿重复创建`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const payload: any = {
        name: form.name.trim(),
        description: form.description,
        system_prompt: form.system_prompt || null,
        model: form.model,
        provider: form.provider,
        config_mode: form.config_mode,
        is_default: form.is_default,
        skills: form.skills,
        tags: form.tags,
        category: form.category,
        enable_planning: form.enable_planning,
        enable_rag: form.enable_rag,
        enable_reflection: form.enable_reflection,
        max_iterations: form.max_iterations,
        memory_strength: form.memory_strength,
        setup_mode: form.setup_mode,
      }
      if (editingId) {
        await agentApi.update(editingId, payload)
      } else {
        await agentApi.create(payload)
      }
      resetForm()
      fetchAgents()
    } catch (e: any) {
      const detail = e?.message || '操作失败'
      setError(detail)
    }
    setSubmitting(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此 Agent？')) return
    await agentApi.remove(id)
    fetchAgents()
  }

  const startEdit = (a: Agent) => {
    setForm({
      id: a.id, name: a.name, description: a.description,
      system_prompt: a.system_prompt || '', model: a.model, provider: a.provider,
      config_mode: (a.config_mode as 'global' | 'self') || 'global',
      is_default: !!a.is_default,
      skills: a.skills || [], tags: a.tags || [], category: a.category,
      enable_planning: a.enable_planning, enable_rag: a.enable_rag,
      enable_reflection: a.enable_reflection,
      max_iterations: a.max_iterations, memory_strength: a.memory_strength,
      setup_mode: (a.setup_mode as 'quick' | 'detailed') || 'detailed',
      showPrompt: !!(a.system_prompt),
    })
    setEditingId(a.id)
    setShowForm(true)
  }

  // ── 技能选择（从已安装技能输入搜索添加）──
  const filteredSkills = installedSkills.filter(s =>
    !form.skills.includes(s.name) &&
    s.name.toLowerCase().includes(skillSearch.toLowerCase())
  )
  const toggleSkill = (name: string) => {
    setForm(f => ({
      ...f,
      skills: f.skills.includes(name) ? f.skills.filter(x => x !== name) : [...f.skills, name],
    }))
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
          {agents.some(a => a.is_default) && (
            <span className="text-xs text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded flex items-center gap-1">
              <Star size={10} /> 全局默认：{agents.find(a => a.is_default)?.name}
            </span>
          )}
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }}
          disabled={submitting}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition-colors">
          <Plus size={16} /> 新建 Agent
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

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
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="简单描述 Agent 的用途（AI 将据此分析与推荐）" />
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
              <select value={form.setup_mode} onChange={e => setForm({...form, setup_mode: e.target.value as any})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none">
                <option value="quick">快速（AI 分析并自动生成）</option>
                <option value="detailed">详细（手动编写 System Prompt）</option>
              </select>
            </div>

            {/* 快速配置：AI 分析按钮 */}
            {form.setup_mode === 'quick' && (
              <div className="col-span-2">
                <div className="flex items-start gap-2 text-xs text-blue-300/80 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 mb-2">
                  <Zap size={14} className="mt-0.5 shrink-0" />
                  <span>快速模式：填写名称与描述后，点击「AI 分析」让系统自动推荐技能、标签、分类，并生成 System Prompt 草稿（下方可查看/微调）。</span>
                </div>
                <button onClick={runAnalyze} disabled={analyzing}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                  {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {analyzing ? 'AI 分析中…' : 'AI 分析并推荐'}
                </button>
              </div>
            )}

            {/* 隐藏的 prompt 填写界面（快速模式 AI 生成后展开；详细模式始终显示） */}
            {form.setup_mode === 'detailed' || form.showPrompt ? (
              <div className="col-span-2">
                <label className="block text-xs text-gray-400 mb-1">
                  System Prompt {form.setup_mode === 'quick' && <span className="text-purple-300">（AI 草稿，可微调）</span>}
                </label>
                <textarea value={form.system_prompt} onChange={e => setForm({...form, system_prompt: e.target.value})} rows={4}
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none resize-none"
                  placeholder={form.setup_mode === 'quick' ? '点击上方「AI 分析并推荐」自动生成…' : '定义 Agent 的角色和行为...'} />
              </div>
            ) : null}

            {/* 技能选择：从已安装技能搜索添加 */}
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">技能（从已安装技能中搜索添加）</label>
              <div className="relative">
                <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
                  <Search size={14} className="text-gray-500" />
                  <input value={skillSearch} onChange={e => { setSkillSearch(e.target.value); setSkillOpen(true) }}
                    onFocus={() => setSkillOpen(true)}
                    placeholder="输入搜索已安装技能，点击添加…"
                    className="flex-1 bg-transparent outline-none text-white text-sm" />
                  {skillOpen && (
                    <button onClick={() => setSkillOpen(false)} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
                  )}
                </div>
                {skillOpen && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl">
                    {filteredSkills.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-500">
                        {installedSkills.length === 0 ? '暂无已安装技能，请先到技能市场安装' : '无匹配技能'}
                      </div>
                    ) : filteredSkills.map(s => (
                      <div key={s.id} onClick={() => { toggleSkill(s.name); setSkillSearch('') }}
                        className="px-3 py-2 text-sm text-gray-200 hover:bg-white/5 cursor-pointer flex items-center gap-2">
                        <Code size={12} className="text-green-400" /> {s.name}
                        <span className="text-[10px] text-gray-500 truncate">{s.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* 已选技能标签 */}
              {form.skills.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {form.skills.map(s => (
                    <span key={s} className="text-[11px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                      <Code size={10} />{s}
                      <button onClick={() => toggleSkill(s)} className="hover:text-red-400"><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 标签 */}
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">标签（AI 推荐或手动，逗号分隔）</label>
              <input value={form.tags.join(', ')} onChange={e => setForm({...form, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none" placeholder="coding, assistant" />
            </div>
          </div>

          {/* 开关组 */}
          <div className="flex gap-6 mt-4 flex-wrap">
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

          {/* 配置来源 + 全局默认 */}
          <div className="flex gap-6 mt-4 flex-wrap items-center">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Globe size={14} className="text-blue-400" />
              <span>配置来源</span>
              <select value={form.config_mode} onChange={e => setForm({...form, config_mode: e.target.value as any})}
                className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-white text-sm focus:border-blue-500 outline-none">
                <option value="global">全局默认配置</option>
                <option value="self">使用本 Agent 自带配置（读取自己的知识库等）</option>
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-amber-300">
              <input type="checkbox" checked={form.is_default} onChange={e => setForm({...form, is_default: e.target.checked})}
                className="rounded bg-white/10 border-white/20 text-amber-500 focus:ring-amber-500" />
              <Star size={14} /> 设为全局默认 Agent
            </label>
          </div>

          <div className="flex gap-3 mt-5">
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm transition-colors">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {submitting ? '保存中…' : (editingId ? '更新' : '创建')}
            </button>
            <button onClick={resetForm} disabled={submitting}
              className="text-gray-400 hover:text-white px-4 py-2 text-sm transition-colors disabled:opacity-50">取消</button>
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
                      {a.is_default && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 flex items-center gap-1">
                          <Star size={9} /> 默认</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${a.status === 'active' ? 'bg-green-500/20 text-green-400' : a.status === 'running' ? 'bg-blue-500/20 text-blue-400' : a.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400'}`}>
                        {a.status === 'active' ? 'Active' : a.status === 'running' ? '运行中' : a.status === 'error' ? '异常' : 'Idle'}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{modeLabel(a.setup_mode)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 flex items-center gap-1">
                        {a.config_mode === 'global' ? <Globe size={9} /> : <UserIcon size={9} />}
                        {a.config_mode === 'global' ? '全局' : '自带'}
                      </span>
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
