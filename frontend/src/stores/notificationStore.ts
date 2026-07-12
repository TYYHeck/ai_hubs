import { create } from 'zustand'

export interface NotificationItem {
  id: string
  title: string
  description?: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration: number
  createdAt: number
}

interface NotificationState {
  items: NotificationItem[]
  add: (item: Omit<NotificationItem, 'id' | 'createdAt'>) => void
  remove: (id: string) => void
  clear: () => void
}

let idCounter = 0

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],

  add: (item) => {
    const id = `notif-${Date.now()}-${idCounter++}`
    const newItem: NotificationItem = {
      ...item,
      id,
      createdAt: Date.now(),
    }
    set({ items: [...get().items, newItem] })

    if (item.duration > 0) {
      setTimeout(() => {
        get().remove(id)
      }, item.duration)
    }
  },

  remove: (id) => {
    set({ items: get().items.filter(i => i.id !== id) })
  },

  clear: () => {
    set({ items: [] })
  },
}))

export function notifySuccess(title: string, description?: string) {
  useNotificationStore.getState().add({
    title,
    description,
    type: 'success',
    duration: 4000,
  })
}

export function notifyError(title: string, description?: string) {
  useNotificationStore.getState().add({
    title,
    description,
    type: 'error',
    duration: 5000,
  })
}

export function notifyInfo(title: string, description?: string) {
  useNotificationStore.getState().add({
    title,
    description,
    type: 'info',
    duration: 4000,
  })
}

export function notifyWarning(title: string, description?: string) {
  useNotificationStore.getState().add({
    title,
    description,
    type: 'warning',
    duration: 4000,
  })
}
