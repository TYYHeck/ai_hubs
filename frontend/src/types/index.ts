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
  cliAutoComplete: boolean;
  cliHistorySize: number;
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
}
