// ============================================================
// AI Hubs Frontend — 类型定义
// ============================================================

export interface AgentInfo {
  name: string;
  status: 'idle' | 'busy';
  current_task_id: string | null;
  skills: string[];
  description: string;
  has_custom_prompt: boolean;
  max_iterations: number;
  enable_planning: boolean;
  enable_rag: boolean;
  enable_reflection: boolean;
}

export interface TaskInfo {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  assigned_agent: string | null;
  result: string | null;
  error: string | null;
  priority: number;
  tags: string[];
  event_log: EventLogEntry[];
  output_files: string[];
  metadata_: Record<string, unknown>;
  analysis_mode?: string;
  think_depth?: number;
  think_visibility?: string;
}

export interface UserSettings {
  theme: 'dark' | 'light';
  fontSize: 'small' | 'medium' | 'large';
  // CLI 端设置
  cliAutoComplete: boolean;
  cliHistorySize: number;
  cliColorEnabled: boolean;
  // Web 端设置
  webCompactMode: boolean;
  webSidebarCollapsed: boolean;
  webAnimationsEnabled: boolean;
  // 客户端设置
  clientAutoStart: boolean;
  clientMinimizeToTray: boolean;
  clientNotificationEnabled: boolean;
  // IDE 设置
  ideTheme: string;
  ideFontSize: number;
  ideTabSize: number;
  ideAutoComplete: boolean;
  ideWordWrap: boolean;
  ideMinimap: boolean;
  ideLineNumbers: boolean;
}

export interface EventLogEntry {
  time: string;
  event: string;
  data: unknown;
}

export interface QueueStatus {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  agents: number;
  idle_agents: number;
}

export interface KnowledgeSource {
  source_id: string;
  filename: string;
  ext: string;
  size: number;
  chunks: number;
}

export interface KnowledgeStats {
  chunks: number;
  sources: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  agentName?: string;
  toolName?: string;
  toolResult?: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface OrchestrationProgress {
  stage: string;
  mode?: string;
  mode_reason?: string;
  description?: string;
  agent?: string;
  agent_count?: number;
  agents?: string[];
  task?: string;
  error?: string;
  result?: OrchestrationResult;
  agent_results?: AgentSubResult[];
  output_files?: string[];
  final_result?: string;
  success?: boolean;
}

export interface OrchestrationResult {
  task_id: string;
  mode: string;
  mode_reason: string;
  agents_used: string[];
  final_result: string;
  output_files: string[];
  success: boolean;
  error: string;
}

export interface AgentSubResult {
  agent: string;
  role?: string;
  stage?: number;
  round?: number;
  result: string;
}

export interface DashboardStats {
  agents: number;
  idle_agents: number;
  tasks_total: number;
  tasks_pending: number;
  tasks_running: number;
  tasks_completed: number;
  tasks_failed: number;
  model: string;
  provider: string;
  memory_count: number;
  kb_stats: KnowledgeStats;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface OrchestrationMode {
  id: string;
  name: string;
  desc: string;
}

export interface SystemInfo {
  python_version: string;
  platform: string;
  cpu_count: number;
  memory_used_mb: number;
  uptime_seconds: number;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  prompt_template: string;
  tags: string[];
  source: string;
  installed: boolean;
  version: string;
  author: string;
  default_config?: Record<string, unknown>;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: 'user' | 'admin';
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
  task_count: number;
}

export interface AdminStats {
  users: number;
  agents: number;
  tasks: number;
  datasets: number;
  skills: number;
  memory: number;
}

export interface DatasetInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  record_count: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetRecord {
  id: string;
  [key: string]: unknown;
}
