// AI Hubs — 主题/字号状态管理 (Zustand)
// 负责：主题切换（dark/light/system）、字号档位、同步到后端 preferences

import { create } from 'zustand'
import { authApi } from '../api/client'

export type ThemeMode = 'dark' | 'light' | 'system'
export type FontSize = 'sm' | 'md' | 'lg' | 'xl'

interface ThemeState {
  /** 用户选择的主题模式（dark/light/system） */
  mode: ThemeMode
  /** 实际生效的主题（dark/light）—— system 模式下根据系统偏好计算 */
  resolved: 'dark' | 'light'
  /** 字号档位 */
  fontSize: FontSize
  /** 初始化完成标记 */
  ready: boolean

  /** 从用户 preferences 初始化主题 */
  initFromPreferences: (prefs: Record<string, unknown> | undefined) => void
  /** 切换主题模式 */
  setMode: (mode: ThemeMode) => void
  /** 切换字号 */
  setFontSize: (size: FontSize) => void
  /** 同步偏好到后端 */
  syncToBackend: () => void
  /** 立即应用主题到 DOM */
  _applyTheme: (theme: 'dark' | 'light') => void
  /** 立即应用字号到 DOM */
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

    const resolved = mode === 'system' ? getSystemTheme() : mode

    set({ mode, resolved, fontSize, ready: true })

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

  syncToBackend: () => {
    const { mode, fontSize } = get()
    authApi.updateMe({
      preferences: {
        theme: mode,
        font_size: fontSize,
      },
    }).catch(() => {
      // 静默失败——本地主题已生效，后端同步失败不影响使用
    })
  },
}))
