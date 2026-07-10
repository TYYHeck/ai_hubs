import { useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ChatView from './components/ChatView';
import TaskManager from './components/TaskManager';
import AgentManager from './components/AgentManager';
import KnowledgeBase from './components/KnowledgeBase';
import Settings from './components/Settings';
import WorkflowEditor from './components/WorkflowEditor';
import SkillMarket from './components/SkillMarket';
import MemoryViewer from './components/MemoryViewer';
import CodeEditor from './components/CodeEditor';
import AdminPanel from './components/AdminPanel';
import DatasetManager from './components/DatasetManager';
import AuthPage from './components/AuthPage';
import { useAppStore } from './stores/appStore';
import { configApi, systemApi, tasksApi, agentsApi, knowledgeApi } from './api/client';

export default function App() {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const activeTab = useAppStore((s) => s.activeTab);
  const setDashboardStats = useAppStore((s) => s.setDashboardStats);
  const setTasks = useAppStore((s) => s.setTasks);
  const setAgents = useAppStore((s) => s.setAgents);
  const setKbSources = useAppStore((s) => s.setKbSources);
  const setCurrentModel = useAppStore((s) => s.setCurrentModel);
  const setModels = useAppStore((s) => s.setModels);
  const setToolsCount = useAppStore((s) => s.setToolsCount);
  const setModeState = useAppStore((s) => s.setModeState);
  const setSystemInfo = useAppStore((s) => s.setSystemInfo);
  const setOrchestrationModes = useAppStore((s) => s.setOrchestrationModes);
  const agents = useAppStore((s) => s.agents);
  const tasks = useAppStore((s) => s.tasks);
  const queueStatus = useAppStore((s) => s.queueStatus);

  // ── 初始数据加载 ──
  const loadAll = useCallback(async () => {
    try {
      const [configRes, systemRes, tasksRes, agentsRes, kbRes, modesRes] = await Promise.all([
        configApi.get(),
        systemApi.info(),
        tasksApi.list(),
        agentsApi.list(),
        knowledgeApi.files(),
        tasksApi.getModes(),
      ]);
      setCurrentModel(configRes.model, configRes.provider);
      setModels(configRes.models || []);
      setToolsCount(configRes.tools);
      setModeState('planning', configRes.planning);
      setModeState('rag', configRes.rag);
      setModeState('reflection', configRes.reflection);
      if (systemRes.ok) setSystemInfo(systemRes.system);
      setTasks(tasksRes.tasks || [], tasksRes.queue);
      setAgents(agentsRes.agents || []);
      setKbSources(kbRes.sources || [], { chunks: kbRes.total_chunks, sources: kbRes.total_sources });
      setOrchestrationModes(modesRes.modes || []);
      setDashboardStats({
        agents: agentsRes.agents?.length || 0,
        idle_agents: agentsRes.agents?.filter((a: { status: string }) => a.status === 'idle').length || 0,
        tasks_total: tasksRes.tasks?.length || 0,
        tasks_pending: tasksRes.queue?.pending || 0,
        tasks_running: tasksRes.queue?.running || 0,
        tasks_completed: tasksRes.queue?.completed || 0,
        tasks_failed: tasksRes.queue?.failed || 0,
        model: configRes.model,
        provider: configRes.provider,
        memory_count: 0,
        kb_stats: { chunks: kbRes.total_chunks, sources: kbRes.total_sources },
      });
    } catch (e) {
      console.error('初始数据加载失败:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // ── 30秒刷新任务和Agent列表 ──
  useEffect(() => {
    const refresh = async () => {
      try {
        const [tRes, aRes] = await Promise.all([tasksApi.list(), agentsApi.list()]);
        setTasks(tRes.tasks || [], tRes.queue);
        setAgents(aRes.agents || []);
      } catch { /* 后台静默刷新 */ }
    };
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket 实时同步（多端推送）──
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;

    const connect = () => {
      try {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws`);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            const evName = msg.event as string;
            if (['task_created', 'agent_created', 'agent_deleted'].includes(evName)) {
              loadAll();
            }
          } catch { /* ignore */ }
        };
        ws.onclose = () => {
          // 断线自动重连（指数退避，最多 10 秒）
          retry = Math.min(retry + 1, 6);
          timer = window.setTimeout(connect, retry * 1500);
        };
        ws.onerror = () => { ws?.close(); };
      } catch { /* ignore */ }
    };
    connect();
    return () => {
      if (timer) clearTimeout(timer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'chat': return <ChatView />;
      case 'tasks': return <TaskManager />;
      case 'agents': return <AgentManager />;
      case 'knowledge': return <KnowledgeBase />;
      case 'workflow': return <WorkflowEditor />;
      case 'skills': return <SkillMarket />;
      case 'memory': return <MemoryViewer />;
      case 'ide': return <CodeEditor />;
      case 'datasets': return <DatasetManager />;
      case 'admin': return <AdminPanel />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  // ── 未登录显示认证页 ──
  if (!loggedIn) {
    return <AuthPage />;
  }

  const pendingCount = queueStatus?.pending || 0;
  const runningCount = queueStatus?.running || 0;

  return (
    <div className="app-layout">
      <Sidebar
        pendingCount={pendingCount}
        runningCount={runningCount}
        agentCount={agents.length}
      />
      <div className="main-area">
        <div className="tab-content">
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
