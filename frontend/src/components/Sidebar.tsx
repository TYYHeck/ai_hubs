import { useAppStore } from '../stores/appStore';
import { LogoText } from './Logo';

const icons: Record<string, string> = {
  dashboard: '📊',
  chat: '💬',
  tasks: '📋',
  agents: '🤖',
  skills: '🎯',
  memory: '🧠',
  knowledge: '📚',
  workflow: '🔀',
  settings: '⚙️',
};

const navItems = [
  { id: 'dashboard' as const, label: '仪表盘', icon: icons.dashboard },
  { id: 'chat' as const, label: '对话', icon: icons.chat },
  { id: 'tasks' as const, label: '任务编排', icon: icons.tasks },
  { id: 'agents' as const, label: 'Agent 管理', icon: icons.agents },
  { id: 'skills' as const, label: '技能市场', icon: icons.skills },
  { id: 'memory' as const, label: '记忆系统', icon: icons.memory },
  { id: 'ide' as const, label: '内置 IDE', icon: '📁' },
  { id: 'knowledge' as const, label: '知识库', icon: icons.knowledge },
  { id: 'datasets' as const, label: '数据集', icon: '🗂️' },
  { id: 'workflow' as const, label: '工作流编辑', icon: icons.workflow },
  { id: 'admin' as const, label: '后台管理', icon: '🛡️' },
  { id: 'settings' as const, label: '系统设置', icon: icons.settings },
];

interface Props {
  pendingCount: number;
  runningCount: number;
  agentCount: number;
}

export default function Sidebar({ pendingCount, runningCount, agentCount }: Props) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const currentModel = useAppStore((s) => s.currentModel);
  const currentProvider = useAppStore((s) => s.currentProvider);
  const systemInfo = useAppStore((s) => s.systemInfo);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <LogoText size="small" />
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item${activeTab === item.id ? ' active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
            {item.id === 'tasks' && pendingCount > 0 && (
              <span className="badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-stats">
        <div className="stat-row">
          <span>模型</span>
          <span className="stat-val">{currentModel || '未连接'}</span>
        </div>
        <div className="stat-row">
          <span>提供商</span>
          <span className="stat-val">{currentProvider || 'N/A'}</span>
        </div>
        <div className="stat-row">
          <span>Agent 数</span>
          <span className="stat-val">{agentCount}</span>
        </div>
        <div className="stat-row">
          <span>运行中</span>
          <span className="stat-val">{runningCount}</span>
        </div>
        <div className="stat-row">
          <span>待处理</span>
          <span className="stat-val">{pendingCount}</span>
        </div>
        {systemInfo && (
          <div className="stat-row">
            <span>内存</span>
            <span className="stat-val">{systemInfo.memory_used_mb.toFixed(0)} MB</span>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        AI Hubs © 2026 · v3.0.0
      </div>
    </aside>
  );
}
