// AI Hubs — 侧边栏导航

import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, Bot, ListTodo, Package,
  Brain, BookOpen, Database, Code2, Workflow, Shield, Settings, LayoutTemplate,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/agents', icon: Bot, label: 'Agent' },
  { to: '/tasks', icon: ListTodo, label: '任务' },
  { to: '/skills', icon: Package, label: '技能市场' },
  { to: '/memory', icon: Brain, label: '记忆' },
  { to: '/knowledge', icon: BookOpen, label: '知识库' },
  { to: '/datasets', icon: Database, label: '数据集' },
  { to: '/workflow', icon: Workflow, label: '工作流' },
  { to: '/settings', icon: Settings, label: '设置' },
]

const workspaceItem = { to: '/workspace', icon: LayoutTemplate, label: '智能工作台' }

const adminItems = [
  { to: '/admin', icon: Shield, label: '后台管理' },
]

export function Sidebar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const splitLayout = useThemeStore((s) => s.splitLayout)

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">
            AH
          </div>
          <span className="text-text-primary font-semibold">AI Hubs</span>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item) => {
          if (item.to === '/') {
            return (
              <>
                <NavLink key={item.to} to={item.to} end className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-accent bg-accent/10 border-r-2 border-accent'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                  }`
                }>
                  <item.icon size={18} />
                  {item.label}
                </NavLink>
                <NavLink key={workspaceItem.to} to={workspaceItem.to} className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-accent bg-accent/10 border-r-2 border-accent'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                  }`
                }>
                  <workspaceItem.icon size={18} />
                  {workspaceItem.label}
                </NavLink>
              </>
            )
          }
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                isActive
                  ? 'text-accent bg-accent/10 border-r-2 border-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`
            }>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          )
        })}

        {!splitLayout && (
          <>
            <NavLink
              to="/chat"
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                  isActive
                    ? 'text-accent bg-accent/10 border-r-2 border-accent'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                }`
              }
            >
              <MessageSquare size={18} />
              对话
            </NavLink>
            <NavLink
              to="/ide"
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                  isActive
                    ? 'text-accent bg-accent/10 border-r-2 border-accent'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                }`
              }
            >
              <Code2 size={18} />
              IDE
            </NavLink>
          </>
        )}

        {/* 管理员菜单 */}
        {user?.role === 'admin' && (
          <>
            <div className="px-5 py-2 mt-2 text-xs text-text-dim uppercase tracking-wider">
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
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
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
          <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-text-muted text-sm">
            {user?.username?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary truncate">{user?.username}</div>
            <div className="text-xs text-text-dim">{user?.role}</div>
          </div>
          <button
            onClick={logout}
            className="text-text-dim hover:text-text-muted text-xs"
            title="退出登录"
          >
            退出
          </button>
        </div>
        {user?.token_quota != null && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
              <span>对话 token 配额</span>
              <span>{(user.token_used || 0).toLocaleString()} / {user.token_quota.toLocaleString()}</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className={`h-full rounded-full ${user.token_used / user.token_quota > 0.9 ? 'bg-red-500' : user.token_used / user.token_quota > 0.7 ? 'bg-amber-500' : 'bg-accent'}`}
                style={{ width: `${Math.min(100, (user.token_used / user.token_quota) * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
