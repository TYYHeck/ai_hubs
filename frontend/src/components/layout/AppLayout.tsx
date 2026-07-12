import type { ReactNode } from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { Menu } from 'lucide-react'

const FAB_SIZE = 40           // 悬浮按钮尺寸（px）
const DRAG_THRESHOLD = 6      // 位移超过该值视为拖动而非点击
const STORAGE_KEY = 'ai_hubs_menu_fab_pos'

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (typeof p.x === 'number' && typeof p.y === 'number') return p
    }
  } catch { /* ignore */ }
  return { x: 8, y: 8 }
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 议题 #7：窄屏悬浮菜单按钮可拖动，避免遮挡页面正常按钮/图标
  const [pos, setPos] = useState(loadPos)
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback((x: number, y: number) => {
    const maxX = window.innerWidth - FAB_SIZE - 4
    const maxY = window.innerHeight - FAB_SIZE - 4
    return { x: Math.min(Math.max(4, x), maxX), y: Math.min(Math.max(4, y), maxY) }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, moved: false }
    setDragging(true)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragState.current
    if (!s) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) s.moved = true
    if (s.moved) setPos(clamp(s.originX + dx, s.originY + dy))
  }, [clamp])

  const onPointerUp = useCallback(() => {
    const s = dragState.current
    dragState.current = null
    setDragging(false)
    if (s && !s.moved) {
      setSidebarOpen(true)   // 未拖动 → 视为点击，打开侧边栏
    } else if (s) {
      setPos((p) => {
        const np = clamp(p.x, p.y)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(np)) } catch { /* ignore */ }
        return np
      })
    }
  }, [clamp])

  // 视口尺寸变化时保证按钮不越界
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])

  return (
    <div className="flex h-screen overflow-hidden">
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ left: pos.x, top: pos.y, width: FAB_SIZE, height: FAB_SIZE, touchAction: 'none' }}
        className={`fixed z-50 flex items-center justify-center rounded-lg bg-bg-secondary border border-border text-text-muted hover:text-accent shadow-lg lg:hidden ${
          dragging ? 'cursor-grabbing opacity-90' : 'cursor-grab'
        }`}
        title="菜单（可拖动）"
      >
        <Menu size={18} />
      </button>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 overflow-y-auto bg-bg-primary">
        {children}
      </main>
    </div>
  )
}
