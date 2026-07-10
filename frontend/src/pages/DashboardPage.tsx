// AI Hubs — 仪表盘

import { useEffect, useState } from 'react'
import { systemApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Bot, ListTodo, Brain, BookOpen, Activity, Database } from 'lucide-react'

interface HealthInfo {
  status: string
  version: string
  database: string
  db_available: boolean
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const [health, setHealth] = useState<HealthInfo | null>(null)

  useEffect(() => {
    systemApi.health().then(setHealth).catch(() => {})
  }, [])

  const stats = [
    { label: 'Agent 数', value: '—', icon: Bot, color: 'text-blue-400' },
    { label: '运行中任务', value: '—', icon: ListTodo, color: 'text-green-400' },
    { label: '记忆条目', value: '—', icon: Brain, color: 'text-purple-400' },
    { label: '知识库', value: '—', icon: BookOpen, color: 'text-orange-400' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-100 mb-1">仪表盘</h1>
      <p className="text-sm text-neutral-500 mb-6">
        欢迎回来，{user?.username}
      </p>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <s.icon size={18} className={s.color} />
            </div>
            <div className="text-2xl font-bold text-neutral-100">{s.value}</div>
            <div className="text-xs text-neutral-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 系统信息 */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-accent" />
          <h2 className="text-sm font-medium text-neutral-200">系统状态</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-neutral-500 mb-1">版本</div>
            <div className="text-neutral-200">{health?.version || '...'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-1">状态</div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${
                health?.status === 'ok' ? 'bg-green-500' : 'bg-neutral-600'
              }`} />
              <span className="text-neutral-200">{health?.status || '...'}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-1">数据库</div>
            <div className="flex items-center gap-1.5">
              <Database size={14} className="text-neutral-500" />
              <span className="text-neutral-200">{health?.database || '...'}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-1">角色</div>
            <div className="text-neutral-200">{user?.role || '...'}</div>
          </div>
        </div>
      </div>

      {/* 开发进度提示 */}
      <div className="card p-5 mt-4 border-dashed">
        <p className="text-sm text-neutral-400">
          v4.0 重构进行中。当前已完成：基础设施 + 认证系统。
        </p>
        <p className="text-xs text-neutral-600 mt-1">
          下一步：对话核心 → Agent管理 → 任务编排 → 记忆系统 → 技能市场 → IDE → 多端
        </p>
      </div>
    </div>
  )
}
