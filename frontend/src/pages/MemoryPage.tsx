import { useState, useEffect, useCallback } from 'react'
import { Brain, GitBranch, RotateCcw, Archive, Search, History, Database } from 'lucide-react'
import { api } from '../api/client'

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
  const [agent, setAgent] = useState('default')
  const [stats, setStats] = useState<Stats | null>(null)
  const [commits, setCommits] = useState<CommitItem[]>([])
  const [context, setContext] = useState<{ role: string; content: string }[]>([])
  const [showContext, setShowContext] = useState(false)
  const [ragQuery, setRagQuery] = useState('')
  const [ragHits, setRagHits] = useState<RagHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, c] = await Promise.all([
        api.get<{ data: Stats }>(`/memory/stats?agent=${encodeURIComponent(agent)}`),
        api.get<{ data: CommitItem[] }>(`/memory/commits?agent=${encodeURIComponent(agent)}`),
      ])
      setStats(s.data)
      setCommits(c.data)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    }
    setLoading(false)
  }, [agent])

  useEffect(() => { fetchAll() }, [fetchAll])

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
      const r = await api.get<{ data: { role: string; content: string }[] }>(
        `/memory/context?agent=${encodeURIComponent(agent)}&query=`
      )
      setContext(r.data)
      setShowContext(true)
    } catch (e: any) {
      setError(e?.message || '预览失败')
    }
  }

  const handleRag = async () => {
    if (!ragQuery.trim()) return
    setError('')
    try {
      const r = await api.post<{ data: RagHit[] }>('/memory/rag/retrieve', {
        query: ragQuery, k: 5,
      })
      setRagHits(r.data)
    } catch (e: any) {
      setError(e?.message || '检索失败')
    }
  }

  const typeColor: Record<string, string> = {
    turn: 'text-blue-400',
    rollback: 'text-amber-400',
    compress: 'text-purple-400',
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Brain className="text-accent" size={24} />
        <h1 className="text-xl font-semibold text-neutral-100">记忆管理</h1>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        git 式版本控制 · 关键词记忆图谱 · 高无损压缩 · RAG 检索。防幻觉的多层记忆保障。
      </p>

      {/* Agent 选择 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-neutral-400">Agent</span>
        <input
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-neutral-200 w-48"
          placeholder="agent 名称"
        />
        <button onClick={handleCompress} className="flex items-center gap-1 px-3 py-1.5 rounded bg-bg-tertiary border border-border text-sm text-neutral-300 hover:text-neutral-100">
          <Archive size={14} /> 压缩记忆
        </button>
        <button onClick={handleContext} className="flex items-center gap-1 px-3 py-1.5 rounded bg-bg-tertiary border border-border text-sm text-neutral-300 hover:text-neutral-100">
          <History size={14} /> 预览上下文
        </button>
      </div>

      {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</div>}
      {msg && <div className="mb-3 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">{msg}</div>}

      {/* 统计 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-2xl font-bold text-neutral-100">{stats.total_entries}</div>
            <div className="text-xs text-neutral-500 mt-1">记忆条目</div>
          </div>
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-400">{stats.compressed_entries}</div>
            <div className="text-xs text-neutral-500 mt-1">已压缩归档</div>
          </div>
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <div className="text-xs text-neutral-500">当前 HEAD</div>
            <div className="text-sm font-mono text-neutral-300 mt-1 truncate">{stats.head_hash || '—'}</div>
          </div>
        </div>
      )}

      {/* 提交历史 */}
      <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <GitBranch size={16} className="text-neutral-400" />
          <h2 className="text-sm font-medium text-neutral-200">提交历史（git 式）</h2>
          {loading && <span className="text-xs text-neutral-600">加载中…</span>}
        </div>
        {commits.length === 0 ? (
          <div className="text-sm text-neutral-600 py-4 text-center">暂无记忆提交。运行任务或对话后自动生成。</div>
        ) : (
          <div className="space-y-2">
            {commits.map((c) => (
              <div key={c.commit_hash} className="flex items-center gap-3 bg-bg-tertiary rounded px-3 py-2">
                <span className={`text-xs font-mono px-2 py-0.5 rounded bg-bg-secondary ${typeColor[c.commit_type] || 'text-neutral-400'}`}>
                  {c.commit_type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-neutral-200 truncate">{c.message}</div>
                  <div className="text-xs text-neutral-600 font-mono">{c.commit_hash}</div>
                </div>
                <span className="text-xs text-neutral-600">{c.message_count} 条</span>
                <button
                  onClick={() => handleRollback(c.commit_hash)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-neutral-400 hover:text-amber-400 hover:border-amber-400/40"
                  title="回退到此提交"
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
          <h2 className="text-sm font-medium text-neutral-200 mb-2">当前上下文（注入 LLM）</h2>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {context.length === 0 ? (
              <div className="text-sm text-neutral-600">空（运行任务后产生记忆）</div>
            ) : context.map((m, i) => (
              <div key={i} className="text-sm">
                <span className={`font-mono text-xs mr-2 ${m.role === 'system' ? 'text-purple-400' : m.role === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
                  [{m.role}]
                </span>
                <span className="text-neutral-300">{m.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RAG 检索 */}
      <div className="bg-bg-secondary border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Database size={16} className="text-neutral-400" />
          <h2 className="text-sm font-medium text-neutral-200">RAG 检索（基于数据集）</h2>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRag()}
            className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-neutral-200"
            placeholder="输入查询，从你的数据集检索相关文档…"
          />
          <button onClick={handleRag} className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-sm">
            <Search size={14} /> 检索
          </button>
        </div>
        <div className="space-y-2">
          {ragHits.length === 0 ? (
            <div className="text-sm text-neutral-600">暂无检索结果。请先在「数据集」中上传数据。</div>
          ) : ragHits.map((h, i) => (
            <div key={i} className="bg-bg-tertiary rounded px-3 py-2">
              <div className="flex justify-between text-xs text-neutral-500 mb-1">
                <span>{h.dataset_name}</span>
                <span>score {h.score}</span>
              </div>
              <div className="text-sm text-neutral-300">{h.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
