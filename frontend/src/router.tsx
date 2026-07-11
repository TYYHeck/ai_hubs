// AI Hubs — 路由配置

import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { AppLayout } from './components/layout/AppLayout'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import ChatPage from './pages/ChatPage'
import AgentsPage from './pages/AgentsPage'
import TasksPage from './pages/TasksPage'
import SkillsPage from './pages/SkillsPage'
import MemoryPage from './pages/MemoryPage'
import KnowledgePage from './pages/KnowledgePage'
import DatasetsPage from './pages/DatasetsPage'
import IdePage from './pages/IdePage'
import WorkflowPage from './pages/WorkflowPage'
import AdminPage from './pages/AdminPage'
import SettingsPage from './pages/SettingsPage'
import WorkspacePage from './pages/WorkspacePage'

function ProtectedRoute() {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}

export const AppRouter = createBrowserRouter([
  {
    path: '/login',
    element: <AuthPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/', element: <Navigate to="/workspace" replace /> },
      { path: '/chat', element: <ChatPage /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/tasks', element: <TasksPage /> },
      { path: '/skills', element: <SkillsPage /> },
      { path: '/memory', element: <MemoryPage /> },
      { path: '/knowledge', element: <KnowledgePage /> },
      { path: '/datasets', element: <DatasetsPage /> },
      { path: '/ide', element: <IdePage /> },
      { path: '/workspace', element: <WorkspacePage /> },
      { path: '/workflow', element: <WorkflowPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
