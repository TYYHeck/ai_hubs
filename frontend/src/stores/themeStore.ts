// AI Hubs — 主题/字号状态管理 (Zustand)
// 负责：主题切换（dark/light/system）、字号档位、同步到后端 preferences

import { create } from 'zustand'
import { authApi } from '../api/client'

export type ThemeMode = 'dark' | 'light' | 'system'
export type FontSize = 'sm' | 'md' | 'lg' | 'xl'

interface ThemeState {
  mode: ThemeMode
  resolved: 'dark' | 'light'
  fontSize: FontSize
  splitLayout: boolean
  ready: boolean

  initFromPreferences: (prefs: Record<string, unknown> | undefined) => void
  setMode: (mode: ThemeMode) => void
  setFontSize: (size: FontSize) => void
  setSplitLayout: (v: boolean) => void
  syncToBackend: () => void
  _applyTheme: (theme: 'dark' | 'light') => void
  _applyFontSize: (size: FontSize) => void
}

function getSystemTheme(): 'dark' | 'light' {
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  resolved: 'dark',
  fontSize: 'md',
  splitLayout: false,
  ready: false,

  _applyTheme: (theme: 'dark' | 'light') => {
    const html = document.documentElement
    if (theme === 'dark') {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
  },

  _applyFontSize: (size: FontSize) => {
    const html = document.documentElement
    html.classList.remove('font-sm', 'font-md', 'font-lg', 'font-xl')
    html.classList.add(`font-${size}`)
  },

  initFromPreferences: (prefs) => {
    const mode = (prefs?.theme as ThemeMode) || 'dark'
    const fontSize = (prefs?.font_size as FontSize) || 'md'
    const splitLayout = (prefs?.split_layout as boolean) || false

    const resolved = mode === 'system' ? getSystemTheme() : mode

    set({ mode, resolved, fontSize, splitLayout, ready: true })

    // 应用主题和字号
    const store = get()
    store._applyTheme(resolved)
    store._applyFontSize(fontSize)

    // 监听系统主题变化（system 模式时）
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', (e) => {
      const current = get()
      if (current.mode === 'system') {
        const newResolved = e.matches ? 'dark' : 'light'
        set({ resolved: newResolved })
        get()._applyTheme(newResolved)
      }
    })
  },

  setMode: (mode) => {
    const resolved = mode === 'system' ? getSystemTheme() : mode
    set({ mode, resolved })
    get()._applyTheme(resolved)
    get().syncToBackend()
  },

  setFontSize: (size) => {
    set({ fontSize: size })
    get()._applyFontSize(size)
    get().syncToBackend()
  },

  setSplitLayout: (v) => {
    set({ splitLayout: v })
    get().syncToBackend()
  },

  syncToBackend: () => {
    const { mode, fontSize, splitLayout } = get()
    authApi.updateMe({
      preferences: { theme: mode, font_size: fontSize, split_layout: splitLayout },
    }).catch(() => {})
  },
}))
