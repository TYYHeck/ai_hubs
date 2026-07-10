import { ListTodo } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'
export default function TasksPage() {
  return <PlaceholderPage title="任务管理" description="创建任务、8种编排模式、暂停恢复、实时日志" icon={<ListTodo size={40} />} milestone="M3: Agent管理+任务编排" />
}
