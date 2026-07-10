import { Settings as SettingsIcon } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'
export default function SettingsPage() {
  return <PlaceholderPage title="设置" description="主题切换、字体大小、API Key 管理、端配置" icon={<SettingsIcon size={40} />} milestone="M6: 多端" />
}
