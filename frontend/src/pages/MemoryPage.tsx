import { useState, useEffect, useCallback, useRef } from 'react'
import { Brain, GitBranch, RotateCcw, Archive, Search, History, Database, Globe, ChevronDown, Bot } from 'lucide-react'
import { api, type Agent } from '../api/client'
import { onAIMutation } from '../stores/chatStore'

interface CommitItem {
  commit_hash: string
  message: string
  parent_hash: string | null
  message_count: number
  commit_type: string
  created_at: string | null
}

interface Stats {
  agent_name: string
  total_entries: number
  compressed_entries: number
  head_hash: string | null
}

interface RagHit {
  dataset_name: string
  text: string
  score: number
}

export default function MemoryPage() {
  const [agent, setAgent] = useState('__all__')
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentSearch, setAgentSearch] = useState('')
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [commits, setCommits] = useState<CommitItem[]>([])
  const [context, setContext] = useState<{ role: string; content: string }[]>([])
  const [showContext, setShowContext] = useState(false)
  const [ragQuery, setRagQuery] = useState('')
  const [ragHits, setRagHits] = useState<RagHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // 加载 Agent 列表
  useEffect(() => {
    api.get<Agent[]>('/agents').then(list => setAgents(list ?? [])).catch(() => {})
  }, [])

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setShowAgentDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // 当前选中的 Agent 信息
  const isAll = agent === '__all__'
  const isGlobal = agent === '__global__'
  const selectedAgent = (isAll || isGlobal) ? null : agents.find(a => a.name === agent)
  const selectedLabel = isAll ? '全部记忆' : isGlobal ? '全局记忆' : (agent || '—')
  // 是否选中了需要具体 agent 的操作模式
  const needsAgent = isAll

  // 搜索过滤 Agent 列表
  const filteredAgents = agentSearch.trim()
    ? agents.filter(a => a.name.toLowerCase().includes(agentSearch.toLowerCase()))
    : agents

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, c] = await Promise.all([
        api.get<Stats>(`/memory/stats?agent=${encodeURIComponent(agent)}`),
        api.get<{ agent: string; commits: CommitItem[] }>(`/memory/commits?agent=${encodeURIComponent(agent)}`),
      ])
      setStats(s ?? null)
      setCommits(c?.commits ?? [])
    } catch (e: any) {
      setError(e?.message || '加载失败')
    }
    setLoading(false)
  }, [agent])

  useEffect(() => { fetchAll() }, [fetchAll])
  // 监听 AI 触发的资源变更 → 自动刷新记忆
  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'memory') fetchAll()
    })
  }, [fetchAll])

  const handleRollback = async (hash: string) => {
    if (!confirm(`确认回退到提交 ${hash}？之后的提交将被移除。`)) return
    setMsg('')
    try {
      await api.post(`/memory/rollback?agent=${encodeURIComponent(agent)}`, { commit_hash: hash })
      setMsg(`已回退到 ${hash}`)
      fetchAll()
    } catch (e: any) {
      setError(e?.message || '回退失败')
    }
  }

  const handleCompress = async () => {
    setMsg('')
    try {
      await api.post(`/memory/compress?agent=${encodeURIComponent(agent)}`)
      setMsg('已触发记忆压缩')
      fetchAll()
    } catch (e: any) {
      setError(e?.message || '压缩失败')
    }
  }

  const handleContext = async () => {
    try {
      const r = await api.get<{ agent: string; context: { role: string; content: string }[] }>(
        `/memory/context?agent=${encodeURIComponent(agent)}&query=`
      )
      setContext(r?.context ?? [])
      setShowContext(true)
    } catch (e: any) {
      setError(e?.message || '预览失败')
    }
  }

  const handleRag = async () => {
    if (!ragQuery.trim()) return
    setError('')
    try {
      const r = await api.post<{ query: string; results: RagHit[] }>('/memory/rag/retrieve', {
        query: ragQuery, k: 5,
      })
      setRagHits(r?.results ?? [])
    } catch (e: any) {
      setError(e?.message || '检索失败')
    }
  }

  const typeColor: Record<string, string> = {
    turn: 'text-blue-600 dark:text-blue-400',
    rollback: 'text-amber-600 dark:text-amber-400',
    compress: 'text-purple-600 dark:text-purple-400',
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Brain className="text-accent" size={24} />
        <h1 className="text-xl font-semibold text-text-primary">记忆管理</h1>
      </div>
      <p className="text-sm text-text-muted mb-4">
        git 式版本控制 · 关键词记忆图谱 · 高无损压缩 · RAG 检索。防幻觉的多层记忆保障。
      </p>

      {/* Agent 选择器 —— 搜索下拉 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-text-muted">记忆库</span>
        <div ref={agentDropdownRef} className="relative">
          <button
            onClick={() => { setShowAgentDropdown(!showAgentDropdown); setAgentSearch('') }}
            className="flex items-center gap-2 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary min-w-[180px] hover:border-accent/50 transition-colors"
          >
            {isAll ? <Database size={14} className="text-accent" /> : isGlobal ? <Globe size={14} className="text-accent" /> : <Bot size={14} className="text-text-muted" />}
            <span className="flex-1 text-left">{selectedLabel}</span>
            {selectedAgent && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${selectedAgent.config_mode === 'global' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-green-500/20 text-green-600 dark:text-green-400'}`}>
                {selectedAgent.config_mode === 'global' ? '全局配置' : '单独配置'}
              </span>
            )}
            {isAll && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                {stats ? stats.total_entries + ' 条' : ''}
              </span>
            )}
            <ChevronDown size={14} className="text-text-muted" />
          </button>
          {showAgentDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-bg-tertiary border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
              {/* 搜索框 */}
              <div className="p-2 border-b border-border">
                <input
                  autoFocus
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  className="w-full bg-bg-secondary border border-border rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-dim"
                  placeholder="搜索 Agent…"
                />
              </div>
              {/* 全部记忆选项 */}
              <button
                onClick={() => { setAgent('__all__'); setShowAgentDropdown(false); setAgentSearch('') }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg-secondary transition-colors ${isAll ? 'bg-accent/10 text-accent' : 'text-text-secondary'}`}
              >
                <Database size={14} className="text-accent" />
                <span>全部记忆</span>
                <span className="ml-auto text-[10px] text-text-muted">汇总所有</span>
              </button>
              {/* 全局记忆选项 */}
              <button
                onClick={() => { setAgent('__global__'); setShowAgentDropdown(false); setAgentSearch('') }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg-secondary transition-colors ${agent === '__global__' ? 'bg-accent/10 text-accent' : 'text-text-secondary'}`}
              >
                <Globe size={14} className="text-accent" />
                <span>全局记忆</span>
                <span className="ml-auto text-[10px] text-text-muted">所有 Agent 共享</span>
              </button>
              {/* Agent 列表 */
              filteredAgents.map(a => (
                <button
                  key={a.id ?? a.name}
                  onClick={() => { setAgent(a.name); setShowAgentDropdown(false); setAgentSearch('') }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg-secondary transition-colors ${agent === a.name ? 'bg-accent/10 text-accent' : 'text-text-secondary'}`}
                >
                  <Bot size={14} className="text-text-muted" />
                  <span>{a.name}</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${a.config_mode === 'global' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-green-500/20 text-green-600 dark:text-green-400'}`}>
                    {a.config_mode === 'global' ? '全局配置' : '单独配置'}
                  </span>
                </button>
              ))}
              {agentSearch && filteredAgents.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-dim">无匹配的 Agent</div>
              )}
            </div>
          )}
        </div>
        <button onClick={handleCompress} disabled={needsAgent}
          className={`flex items-center gap-1 px-3 py-1.5 rounded bg-bg-tertiary border border-border text-sm transition-colors ${needsAgent ? 'text-text-dim cursor-not-allowed' : 'text-text-secondary hover:text-text-primary'}`}
          title={needsAgent ? '请先选择特定 Agent' : '压缩记忆'}
        >
          <Archive size={14} /> 压缩记忆
        </button>
        <button onClick={handleContext} disabled={needsAgent}
          className={`flex items-center gap-1 px-3 py-1.5 rounded bg-bg-tertiary border border-border text-sm transition-colors ${needsAgent ? 'text-text-dim cursor-not-allowed' : 'text-text-secondary hover:text-text-primary'}`}
          title={needsAgent ? '请先选择特定 Agent' : '预览上下文'}
        >
          <History size={14} /> 预览上下文
        </button>
      </div>

      {error && <div className="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</div>}
      {msg && <div className="mb-3 text-sm text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">{msg}</div>}

      {/* 统计 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-2xl font-bold text-text-primary">{stats.total_entries}</div>
            <div className="text-xs text-text-muted mt-1">记忆条目</div>
          </div>
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.compressed_entries}</div>
            <div className="text-xs text-text-muted mt-1">已压缩归档</div>
          </div>
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-xs text-text-muted">当前 HEAD</div>
            <div className="text-sm font-mono text-text-secondary mt-1 truncate">{stats.head_hash || '—'}</div>
          </div>
        </div>
      )}

      {/* 提交历史 */}
      <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <GitBranch size={16} className="text-text-muted" />
          <h2 className="text-sm font-medium text-text-primary">提交历史（git 式）</h2>
          {loading && <span className="text-xs text-text-dim">加载中…</span>}
        </div>
        {commits.length === 0 ? (
          <div className="text-sm text-text-dim py-4 text-center">暂无记忆提交。运行任务或对话后自动生成。</div>
        ) : (
          <div className="space-y-2">
            {commits.map((c) => (
              <div key={c.commit_hash} className="flex items-center gap-3 bg-bg-tertiary rounded px-3 py-2">
                <span className={`text-xs font-mono px-2 py-0.5 rounded bg-bg-secondary ${typeColor[c.commit_type] || 'text-text-muted'}`}>
                  {c.commit_type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{c.message}</div>
                  <div className="text-xs text-text-dim font-mono">{c.commit_hash}</div>
                </div>
                <span className="text-xs text-text-dim">{c.message_count} 条</span>
                <button
                  onClick={() => handleRollback(c.commit_hash)}
                  disabled={needsAgent}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${needsAgent ? 'border-border/30 text-text-dim cursor-not-allowed' : 'border-border text-text-muted hover:text-amber-500 dark:hover:text-amber-400 hover:border-amber-500/40'}`}
                  title={needsAgent ? '请先选择特定 Agent' : '回退到此提交'}
                >
                  <RotateCcw size={12} /> 回退
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 上下文预览 */}
      {showContext && (
        <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-5">
          <h2 className="text-sm font-medium text-text-primary mb-2">当前上下文（注入 LLM）</h2>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {context.length === 0 ? (
              <div className="text-sm text-text-dim">空（运行任务后产生记忆）</div>
            ) : context.map((m, i) => (
              <div key={i} className="text-sm">
                <span className={`font-mono text-xs mr-2 ${m.role === 'system' ? 'text-purple-600 dark:text-purple-400' : m.role === 'user' ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}`}>
                  [{m.role}]
                </span>
                <span className="text-text-secondary">{m.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RAG 检索 */}
      <div className="bg-bg-secondary border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Database size={16} className="text-text-muted" />
          <h2 className="text-sm font-medium text-text-primary">RAG 检索（基于数据集）</h2>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRag()}
            className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary"
            placeholder="输入查询，从你的数据集检索相关文档…"
          />
          <button onClick={handleRag} className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-sm">
            <Search size={14} /> 检索
          </button>
        </div>
        <div className="space-y-2">
          {ragHits.length === 0 ? (
            <div className="text-sm text-text-dim">暂无检索结果。请先在「数据集」中上传数据。</div>
          ) : ragHits.map((h, i) => (
            <div key={i} className="bg-bg-tertiary rounded px-3 py-2">
              <div className="flex justify-between text-xs text-text-muted mb-1">
                <span>{h.dataset_name}</span>
                <span>score {h.score}</span>
              </div>
              <div className="text-sm text-text-secondary">{h.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
