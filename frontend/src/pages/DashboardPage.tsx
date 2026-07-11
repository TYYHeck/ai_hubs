// AI Hubs — 仪表盘

import { useEffect, useState } from 'react'
import { systemApi, dashboardApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Bot, ListTodo, Brain, BookOpen, Activity, Database } from 'lucide-react'

interface HealthInfo {
  status: string
  version: string
  database: string
  db_available: boolean
}

interface StatsInfo {
  agents: number
  running_tasks: number
  memory_entries: number
  datasets: number
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [stats, setStats] = useState<StatsInfo | null>(null)

  useEffect(() => {
    systemApi.health().then(setHealth).catch(() => {})
    dashboardApi.stats().then(setStats).catch(() => {})
  }, [])

  const statItems = [
    { label: 'Agent 数', value: stats?.agents ?? '—', icon: Bot, color: 'text-blue-400' },
    { label: '运行中任务', value: stats?.running_tasks ?? '—', icon: ListTodo, color: 'text-green-400' },
    { label: '记忆条目', value: stats?.memory_entries ?? '—', icon: Brain, color: 'text-purple-400' },
    { label: '知识库', value: stats?.datasets ?? '—', icon: BookOpen, color: 'text-orange-400' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-text-primary mb-1">仪表盘</h1>
      <p className="text-sm text-text-muted mb-6">
        欢迎回来，{user?.username}
      </p>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statItems.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <s.icon size={18} className={s.color} />
            </div>
            <div className="text-2xl font-bold text-text-primary">
              {s.value}
            </div>
            <div className="text-xs text-text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 系统信息 */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-accent" />
          <h2 className="text-sm font-medium text-text-primary">系统状态</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-text-muted mb-1">版本</div>
            <div className="text-text-primary">{health?.version || '...'}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">状态</div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${
                health?.status === 'ok' ? 'bg-green-500' : 'bg-text-dim'
              }`} />
              <span className="text-text-primary">{health?.status || '...'}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">数据库</div>
            <div className="flex items-center gap-1.5">
              <Database size={14} className="text-text-muted" />
              <span className="text-text-primary">{health?.database || '...'}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">角色</div>
            <div className="text-text-primary">{user?.role || '...'}</div>
          </div>
        </div>
      </div>

      {/* 提示 */}
      <div className="card p-5 mt-4 border-dashed">
        <p className="text-sm text-text-secondary">
          v4.0 持续迭代中。更多功能即将推出。
        </p>
        <p className="text-xs text-text-dim mt-1">
          对话核心 · Agent管理 · 任务编排 · 记忆系统 · 技能市场 · IDE · 多端
        </p>
      </div>
    </div>
  )
}
