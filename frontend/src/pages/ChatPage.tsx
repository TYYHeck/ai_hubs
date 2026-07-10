import { MessageSquare } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'
export default function ChatPage() {
  return <PlaceholderPage title="对话" description="与 AI Agent 流式对话，支持思考过程展示、指令补全、上下文回溯" icon={<MessageSquare size={40} />} milestone="M2: 对话核心" />
}
