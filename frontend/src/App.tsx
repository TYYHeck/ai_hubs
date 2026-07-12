// AI Hubs — 应用根组件

import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useThemeStore } from './stores/themeStore'
import { useLocalProxyStore } from './stores/localProxyStore'
import { AppRouter } from './router'
import NotificationContainer from './components/NotificationContainer'

export default function App() {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const user = useAuthStore((s) => s.user)
  const initFromPreferences = useThemeStore((s) => s.initFromPreferences)
  const connectProxy = useLocalProxyStore((s) => s.connect)

  useEffect(() => { checkAuth() }, [checkAuth])

  // 用户加载完成后初始化主题 + 启动本地代理（桌面客户端）
  useEffect(() => {
    if (user?.preferences) {
      initFromPreferences(user.preferences)
    } else if (user !== null) {
      initFromPreferences({ theme: 'dark', font_size: 'md' })
    }
    if (user) connectProxy()
  }, [user, initFromPreferences, connectProxy])

  // checkAuth 未完成时不渲染（避免闪烁）
  if (user === null && localStorage.getItem('ai_hubs_token')) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="text-text-muted animate-pulse">加载中...</div>
      </div>
    )
  }

  return (
    <>
      <RouterProvider router={AppRouter} />
      <NotificationContainer />
    </>
  )
}
