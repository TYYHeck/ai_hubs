import { useNotificationStore } from '../stores/notificationStore'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const icons = {
  success: <CheckCircle2 size={18} className="text-green-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  info: <Info size={18} className="text-blue-500" />,
  warning: <AlertTriangle size={18} className="text-yellow-500" />,
}

const bgColors = {
  success: 'bg-green-500/10 border-green-500/30',
  error: 'bg-red-500/10 border-red-500/30',
  info: 'bg-blue-500/10 border-blue-500/30',
  warning: 'bg-yellow-500/10 border-yellow-500/30',
}

export default function NotificationContainer() {
  const items = useNotificationStore(s => s.items)
  const remove = useNotificationStore(s => s.remove)

  if (items.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {items.map(item => (
        <div
          key={item.id}
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm ${bgColors[item.type]} animate-slide-in`}
        >
          <div className="flex-shrink-0 mt-0.5">{icons[item.type]}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary">{item.title}</div>
            {item.description && (
              <div className="text-xs text-text-secondary mt-0.5">{item.description}</div>
            )}
          </div>
          <button
            onClick={() => remove(item.id)}
            className="flex-shrink-0 p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
