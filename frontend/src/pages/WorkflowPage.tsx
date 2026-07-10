import { Workflow } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'
export default function WorkflowPage() {
  return <PlaceholderPage title="工作流" description="可视化工作流编排，节点拖拽、连线、运行预览" icon={<Workflow size={40} />} milestone="M3: Agent管理+任务编排" />
}
