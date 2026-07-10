// AI Hubs — 应用根组件

import { useEffect } from 'react'
import { useAuthStore } from './stores/authStore'
import { AppRouter } from './router'

export default function App() {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  // checkAuth 未完成时不渲染（避免闪烁）
  if (user === null && localStorage.getItem('ai_hubs_token')) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="text-neutral-500 animate-pulse">加载中...</div>
      </div>
    )
  }

  return <AppRouter />
}
