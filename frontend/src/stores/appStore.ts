// ============================================================
// AI Hubs Frontend — Zustand 全局状态
// ============================================================

import { create } from 'zustand';
import type {
  AgentInfo, TaskInfo, QueueStatus, KnowledgeSource,
  KnowledgeStats, ChatMessage, OrchestrationProgress, ModelInfo,
  OrchestrationMode, DashboardStats,
} from '../types';

interface AppState {
  // ── UI 状态 ──
  activeTab: 'dashboard' | 'chat' | 'tasks' | 'agents' | 'knowledge' | 'workflow' | 'settings' | 'skills' | 'memory' | 'ide';
  setActiveTab: (tab: AppState['activeTab']) => void;

  // ── 认证 ──
  loggedIn: boolean;
  token: string | null;
  currentUser: Record<string, unknown> | null;
  setLoggedIn: (v: boolean, token?: string) => void;
  setCurrentUser: (user: Record<string, unknown>) => void;
  logout: () => void;

  // ── 对话 ──
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setStreaming: (v: boolean) => void;
  selectedAgentForChat: string;
  setSelectedAgentForChat: (name: string) => void;

  // ── 仪表盘 ──
  dashboardStats: DashboardStats | null;
  setDashboardStats: (stats: DashboardStats) => void;

  // ── 任务 ──
  tasks: TaskInfo[];
  taskFilter: string;
  queueStatus: QueueStatus | null;
  selectedTask: TaskInfo | null;
  orchestrationProgress: OrchestrationProgress | null;
  orchestrationModes: OrchestrationMode[];
  setTasks: (tasks: TaskInfo[], queue: QueueStatus) => void;
  setTaskFilter: (filter: string) => void;
  setSelectedTask: (task: TaskInfo | null) => void;
  setOrchestrationProgress: (p: OrchestrationProgress | null) => void;
  setOrchestrationModes: (modes: OrchestrationMode[]) => void;

  // ── Agent ──
  agents: AgentInfo[];
  setAgents: (agents: AgentInfo[]) => void;

  // ── 知识库 ──
  kbSources: KnowledgeSource[];
  kbStats: KnowledgeStats | null;
  setKbSources: (sources: KnowledgeSource[], stats: KnowledgeStats) => void;

  // ── 配置 ──
  models: ModelInfo[];
  currentModel: string;
  currentProvider: string;
  planningEnabled: boolean;
  ragEnabled: boolean;
  reflectionEnabled: boolean;
  toolsCount: number;
  setModels: (models: ModelInfo[]) => void;
  setCurrentModel: (model: string, provider: string) => void;
  setToolsCount: (n: number) => void;
  setModeState: (mode: string, enabled: boolean) => void;

  // ── 系统 ──
  systemInfo: import('../types').SystemInfo | null;
  setSystemInfo: (info: import('../types').SystemInfo) => void;
}

let msgIdCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++msgIdCounter}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── UI ──
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // ── 认证 ──
  loggedIn: !!localStorage.getItem('token'),
  token: localStorage.getItem('token'),
  currentUser: null,
  setLoggedIn: (v, token) => {
    if (token) localStorage.setItem('token', token);
    set({ loggedIn: v, token: token || get().token });
  },
  setCurrentUser: (user) => set({ currentUser: user }),
  logout: () => { localStorage.removeItem('token'); set({ loggedIn: false, token: null, currentUser: null }); },

  // ── 对话 ──
  messages: [],
  isStreaming: false,
  selectedAgentForChat: 'AI Hubs',
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastMessage: (content) => set((s) => {
    const msgs = [...s.messages];
    if (msgs.length > 0) {
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
    }
    return { messages: msgs };
  }),
  clearMessages: () => set({ messages: [] }),
  setStreaming: (v) => set({ isStreaming: v }),
  setSelectedAgentForChat: (name) => set({ selectedAgentForChat: name }),

  // ── 仪表盘 ──
  dashboardStats: null,
  setDashboardStats: (stats) => set({ dashboardStats: stats }),

  // ── 任务 ──
  tasks: [],
  taskFilter: '',
  queueStatus: null,
  selectedTask: null,
  orchestrationProgress: null,
  orchestrationModes: [],
  setTasks: (tasks, queue) => set({ tasks, queueStatus: queue }),
  setTaskFilter: (filter) => set({ taskFilter: filter }),
  setSelectedTask: (task) => set({ selectedTask: task }),
  setOrchestrationProgress: (p) => set({ orchestrationProgress: p }),
  setOrchestrationModes: (modes) => set({ orchestrationModes: modes }),

  // ── Agent ──
  agents: [],
  setAgents: (agents) => set({ agents }),

  // ── 知识库 ──
  kbSources: [],
  kbStats: null,
  setKbSources: (sources, stats) => set({ kbSources: sources, kbStats: stats }),

  // ── 配置 ──
  models: [],
  currentModel: '',
  currentProvider: '',
  planningEnabled: false,
  ragEnabled: true,
  reflectionEnabled: false,
  toolsCount: 0,
  setModels: (models) => set({ models }),
  setCurrentModel: (model, provider) => set({ currentModel: model, currentProvider: provider }),
  setToolsCount: (n) => set({ toolsCount: n }),
  setModeState: (mode, enabled) => {
    if (mode === 'planning') set({ planningEnabled: enabled });
    else if (mode === 'rag') set({ ragEnabled: enabled });
    else if (mode === 'reflection') set({ reflectionEnabled: enabled });
  },

  // ── 系统 ──
  systemInfo: null,
  setSystemInfo: (info) => set({ systemInfo: info }),
}));

// ── 工具函数 ──

export function createUserMessage(content: string): ChatMessage {
  return {
    id: nextId(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

export function createAgentMessage(agentName?: string): ChatMessage {
  return {
    id: nextId(),
    role: 'agent',
    content: '',
    agentName,
    timestamp: Date.now(),
    isStreaming: true,
  };
}
