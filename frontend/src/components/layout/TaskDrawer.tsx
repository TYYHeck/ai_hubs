// AI Hubs — 全局任务侧边栏（右上角任务按钮展开）
// 实时显示任务流程 + 当前正在工作的 Agent

import { useEffect, useRef, useState } from 'react'
import { ListTodo, X, Play, Pause, RotateCw, Trash2, Bot, Loader2, ChevronRight, Activity, FileText, Download } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../api/client'
import { getToken } from '../../api/client'

async function readSSE(taskId: string, onMessage: (data: any) => void, signal: AbortSignal) {
  try {
    const res = await fetch(`/api/v1/tasks/${taskId}/stream`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      signal,
    })
    if (!res.ok || !res.body) return
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { onMessage(JSON.parse(line.slice(6))) } catch { /* ignore */ }
        }
      }
    }
  } catch { /* aborted or network error */ }
}

interface TaskItem {
  id: string
  title: string
  description: string | null
  status: string
  mode: string
  assigned_agent: string | null
  result: string | null
  error: string | null
  output_files?: { path: string; name: string; size: number; is_new: boolean; ext: string }[]
  created_at: string | null
  started_at: string | null
  finished_at: string | null
}

interface TaskEvent {
  time: string
  event: string
  data?: any
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  running: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-500/20 text-green-600 dark:text-green-400',
  failed: 'bg-red-500/20 text-red-600 dark:text-red-400',
  paused: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  cancelled: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
}
const statusLabel: Record<string, string> = {
  pending: '等待中', running: '运行中', completed: '已完成',
  failed: '失败', paused: '已暂停', cancelled: '已取消',
}

export function TaskDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [workingAgent, setWorkingAgent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const esRef = useRef<AbortController | null>(null)
  const eventsEndRef = useRef<HTMLDivElement>(null)

  const fetchTasks = async () => {
    try {
      const res = await api.get<TaskItem[]>('/tasks')
      setTasks(res ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    if (open) fetchTasks()
  }, [open])

  // 轮询运行中任务的实时事件（fetch 流式 SSE）
  useEffect(() => {
    const running = tasks.find((t) => t.status === 'running')
    if (!running) {
      setWorkingAgent(null)
      if (esRef.current) { esRef.current.abort(); esRef.current = null }
      return
    }
    setActiveTaskId(running.id)
    setEvents([])
    if (esRef.current) esRef.current.abort()
    const ctrl = new AbortController()
    esRef.current = ctrl
    readSSE(running.id, (evt) => {
      if (evt.event === 'agent_start') setWorkingAgent(evt.data?.agent || null)
      if (evt.event === 'agent_done' || evt.event === 'task_completed' || evt.event === 'task_failed') {
        setWorkingAgent(null)
        fetchTasks()
      }
      setEvents((prev) => [...prev, evt])
    }, ctrl.signal)
    return () => { ctrl.abort(); esRef.current = null }
  }, [tasks])

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const handleExecute = async (id: string) => {
    await api.post(`/tasks/${id}/execute`)
    fetchTasks()
  }
  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此任务？')) return
    await api.delete(`/tasks/${id}`)
    fetchTasks()
  }

  if (!open) return null

  return (
    <div className="fixed top-0 right-0 h-full w-[380px] bg-bg-secondary border-l border-border shadow-2xl z-40 flex flex-col animate-slide-in">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ListTodo size={18} className="text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-medium text-text-primary">任务流程</span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
      </div>

      {/* 正在工作的 Agent */}
      {workingAgent && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center gap-2">
          <Bot size={16} className="text-blue-600 dark:text-blue-400" />
          <span className="text-xs text-blue-600 dark:text-blue-300">当前工作中：</span>
          <span className="text-sm font-medium text-blue-700 dark:text-blue-200">{workingAgent}</span>
          <Loader2 size={14} className="text-blue-600 dark:text-blue-400 animate-spin ml-auto" />
        </div>
      )}

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="text-sm text-text-dim text-center py-8">加载中…</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-text-dim text-center py-8">
            <ListTodo size={32} className="mx-auto mb-2 opacity-30" />
            暂无任务
          </div>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="bg-bg-tertiary border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColors[t.status] || 'text-text-muted'}`}>
                  {statusLabel[t.status] || t.status}
                </span>
                <span className="text-sm text-text-primary font-medium truncate flex-1">{t.title}</span>
                <button onClick={() => setActiveTaskId(activeTaskId === t.id ? null : t.id)}
                  className="text-text-muted hover:text-text-secondary"><ChevronRight size={14}
                    style={{ transform: activeTaskId === t.id ? 'rotate(90deg)' : '' }} /></button>
              </div>
              {t.assigned_agent && (
                <div className="text-[11px] text-text-muted mb-1 flex items-center gap-1">
                  <Bot size={11} /> {t.assigned_agent}
                </div>
              )}
              {t.result && (
                <div className="text-xs text-text-muted line-clamp-3 bg-black/20 rounded p-2 mt-1 prose prose-invert prose-xs max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {t.result}
                  </ReactMarkdown>
                </div>
              )}
              {t.output_files && t.output_files.length > 0 && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-green-600 dark:text-green-400">
                  <FileText size={10} /> {t.output_files.length} 个产出文件
                </div>
              )}
              <div className="flex items-center gap-1 mt-2">
                {t.status === 'pending' && (
                  <button onClick={() => handleExecute(t.id)} className="p-1 text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded" title="执行">
                    <Play size={13} /></button>
                )}
                <button onClick={() => handleDelete(t.id)} className="p-1 text-text-muted hover:text-red-500 dark:hover:text-red-400 rounded ml-auto" title="删除">
                  <Trash2 size={13} /></button>
              </div>

              {/* 展开的事件流 */}
              {activeTaskId === t.id && (
                <div className="mt-2 border-t border-border pt-2 space-y-1 max-h-48 overflow-y-auto">
                  <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Activity size={10} /> 执行流程
                  </div>
                  {events.length === 0 ? (
                    <div className="text-[11px] text-text-dim">暂无事件</div>
                  ) : (
                    events.map((ev, i) => (
                      <div key={i} className="text-[11px] font-mono text-text-muted flex gap-2">
                        <span className="text-text-dim">{ev.time?.slice(11, 19)}</span>
                        <span className="text-accent/80">{ev.event}</span>
                        <span className="text-text-muted truncate flex-1">
                          {ev.data?.agent && `→ ${ev.data.agent}`}
                          {ev.data?.error && `✗ ${ev.data.error}`}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={eventsEndRef} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
