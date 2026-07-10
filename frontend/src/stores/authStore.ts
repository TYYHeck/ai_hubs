// AI Hubs — 认证状态管理 (Zustand)

import { create } from 'zustand'
import { authApi, setToken } from '../api/client'
import type { User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  // 操作
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const res = await authApi.login(username, password)
      setToken(res.access_token)
      set({ user: res.user, loading: false })
      return true
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
      return false
    }
  },

  logout: () => {
    setToken(null)
    set({ user: null })
  },

  checkAuth: async () => {
    const token = localStorage.getItem('ai_hubs_token')
    if (!token) {
      set({ user: null })
      return
    }
    try {
      const res = await authApi.me()
      set({ user: res.user })
    } catch {
      setToken(null)
      set({ user: null })
    }
  },

  clearError: () => set({ error: null }),
}))
