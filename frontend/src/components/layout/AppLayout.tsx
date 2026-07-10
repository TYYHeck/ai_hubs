// AI Hubs — 主布局

import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-bg-primary">
        {children}
      </main>
    </div>
  )
}
