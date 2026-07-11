import type { ReactNode } from 'react'
import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Menu } from 'lucide-react'

export function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-2 left-2 z-50 p-2 rounded-lg bg-bg-secondary border border-border text-text-muted hover:text-accent lg:hidden"
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