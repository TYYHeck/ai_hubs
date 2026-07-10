// AI Hubs — 侧边栏导航

import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, Bot, ListTodo, Package,
  Brain, BookOpen, Database, Code2, Workflow, Shield, Settings,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/chat', icon: MessageSquare, label: '对话' },
  { to: '/agents', icon: Bot, label: 'Agent' },
  { to: '/tasks', icon: ListTodo, label: '任务' },
  { to: '/skills', icon: Package, label: '技能市场' },
  { to: '/memory', icon: Brain, label: '记忆' },
  { to: '/knowledge', icon: BookOpen, label: '知识库' },
  { to: '/datasets', icon: Database, label: '数据集' },
  { to: '/ide', icon: Code2, label: 'IDE' },
  { to: '/workflow', icon: Workflow, label: '工作流' },
  { to: '/settings', icon: Settings, label: '设置' },
]

const adminItems = [
  { to: '/admin', icon: Shield, label: '后台管理' },
]

export function Sidebar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">
            AH
          </div>
          <span className="text-neutral-100 font-semibold">AI Hubs</span>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                isActive
                  ? 'text-accent bg-accent/10 border-r-2 border-accent'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-bg-tertiary'
              }`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}

        {/* 管理员菜单 */}
        {user?.role === 'admin' && (
          <>
            <div className="px-5 py-2 mt-2 text-xs text-neutral-600 uppercase tracking-wider">
              管理
            </div>
            {adminItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-accent bg-accent/10 border-r-2 border-accent'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-bg-tertiary'
                  }`
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* 用户信息 */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-neutral-400 text-sm">
            {user?.username?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-neutral-200 truncate">{user?.username}</div>
            <div className="text-xs text-neutral-600">{user?.role}</div>
          </div>
          <button
            onClick={logout}
            className="text-neutral-600 hover:text-neutral-400 text-xs"
            title="退出登录"
          >
            退出
          </button>
        </div>
      </div>
    </aside>
  )
}
