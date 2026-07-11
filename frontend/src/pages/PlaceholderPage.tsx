// AI Hubs — 页面占位组件（后续里程碑逐步替换为真实功能）

import type { ReactNode } from 'react'

interface PlaceholderProps {
  title: string
  description: string
  icon?: ReactNode
  milestone?: string
}

export function PlaceholderPage({ title, description, icon, milestone }: PlaceholderProps) {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-text-primary mb-1">{title}</h1>
      <p className="text-sm text-text-muted mb-6">{description}</p>

      <div className="card p-12 flex flex-col items-center justify-center text-center border-dashed">
        {icon && <div className="mb-4 text-text-dim">{icon}</div>}
        <h2 className="text-lg text-text-muted mb-2">功能开发中</h2>
        <p className="text-sm text-text-dim max-w-md">
          此模块将在 <span className="text-accent">{milestone || '后续里程碑'}</span> 中实现。
        </p>
      </div>
    </div>
  )
}
