// AI Hubs — 本地工具代理 WebSocket 客户端
// 仅在 Electron 桌面客户端中使用。
// 建立 WebSocket 连接后，后端 AI 工具调用将优先转发到本地执行。

import { create } from 'zustand'
import { getToken } from '../api/client'

// 从 window 获取桌面 IDE 桥接
interface DesktopIde {
  tree: (root: string) => Promise<unknown>
  readFile: (abs: string) => Promise<{ path: string; name: string; content: string; size: number }>
  writeFile: (abs: string, content: string) => Promise<{ path: string; name: string; size: number }>
  mkdir: (abs: string) => Promise<{ path: string; type: string }>
  delete: (abs: string) => Promise<{ ok: boolean }>
  join: (root: string, rel: string) => Promise<string>
  run: (abs: string, args?: string[]) => Promise<{ stdout: string; stderr: string; exit_code: number; timed_out: boolean; command: string }>
}

function getDesktopIde(): DesktopIde | undefined {
  return (window as unknown as { aiHubsDesktop?: { ide?: DesktopIde } }).aiHubsDesktop?.ide
}

interface LocalProxyState {
  connected: boolean
  rootPath: string   // 用户选择的本地项目根目录
  ws: WebSocket | null
  connect: () => void
  disconnect: () => void
  setRootPath: (path: string) => void
}

// 执行工具调用（本地）
async function executeLocally(tool: string, args: Record<string, unknown>, rootPath: string): Promise<Record<string, unknown>> {
  const ide = getDesktopIde()
  if (!ide) return { error: '无本地 IDE 桥接' }

  const resolve = async (rel: string): Promise<string> => {
    if (!rel || rel === '.') return rootPath
    if (rel.startsWith('/') || rel.match(/^[A-Za-z]:/)) return rel
    return await ide.join(rootPath, rel)
  }

  try {
    switch (tool) {
      case 'read_file': {
        const abs = await resolve(args.path as string)
        const r = await ide.readFile(abs)
        return { ok: true, path: args.path, name: r.name, content: r.content, size: r.size }
      }

      case 'write_file': {
        const abs = await resolve(args.path as string)
        const r = await ide.writeFile(abs, args.content as string)
        return { ok: true, path: args.path, name: r.name, size: r.size }
      }

      case 'list_files': {
        const abs = await resolve((args.path as string) || '.')
        const tree = await ide.tree(abs)
        return { ok: true, entries: flattenTree(tree, rootPath) }
      }

      case 'run_code': {
        // 写临时文件再执行
        const ext = langToExt(args.language as string)
        const tmpName = `_agent_${Date.now()}${ext}`
        const tmpAbs = await ide.join(rootPath, tmpName)
        await ide.writeFile(tmpAbs, args.code as string)
        try {
          const r = await ide.run(tmpAbs, (args.args as string[]) || [])
          return { stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code, timed_out: r.timed_out, command: r.command }
        } finally {
          try { await ide.delete(tmpAbs) } catch { /* ignore */ }
        }
      }

      case 'run_terminal': {
        // run_terminal 在桌面模式下用 run 代替（有限支持）
        const cmd = args.command as string
        // 写 bash 脚本执行
        const tmpName = `_cmd_${Date.now()}.sh`
        const tmpAbs = await ide.join(rootPath, tmpName)
        await ide.writeFile(tmpAbs, `#!/bin/bash\ncd "${rootPath}"\n${cmd}`)
        try {
          const r = await ide.run(tmpAbs, [])
          return { stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code, timed_out: r.timed_out, command: cmd }
        } finally {
          try { await ide.delete(tmpAbs) } catch { /* ignore */ }
        }
      }

      default:
        return { error: `本地不支持工具: ${tool}` }
    }
  } catch (e) {
    return { error: String(e) }
  }
}

function langToExt(lang: string): string {
  const m: Record<string, string> = {
    python: '.py', py: '.py',
    javascript: '.js', js: '.js', node: '.js',
    bash: '.sh', sh: '.sh',
    c: '.c', cpp: '.cpp', java: '.java',
  }
  return m[lang?.toLowerCase()] || '.py'
}

function flattenTree(node: unknown, rootPath: string): unknown[] {
  if (!node || typeof node !== 'object') return []
  const n = node as { name?: string; path?: string; type?: string; children?: unknown[] }
  const rel = (n.path || '').replace(rootPath, '').replace(/^[\\/]/, '') || n.name || ''
  const entries: unknown[] = []
  if (n.type !== 'dir') {
    entries.push({ name: n.name, path: rel, type: n.type, size: 0 })
  }
  for (const child of n.children || []) {
    entries.push(...flattenTree(child, rootPath))
  }
  return entries
}

const WS_BASE = (() => {
  const loc = window.location
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`
})()

export const useLocalProxyStore = create<LocalProxyState>((set, get) => ({
  connected: false,
  rootPath: '',
  ws: null,

  setRootPath: (path) => {
    set({ rootPath: path })
    // 通知后端根目录变化
    get().ws?.send(JSON.stringify({ type: 'set_root', root: path }))
  },

  connect: () => {
    const ide = getDesktopIde()
    if (!ide) return  // 非桌面客户端，不连接
    const token = getToken()
    if (!token) return

    const existing = get().ws
    if (existing && existing.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(`${WS_BASE}/api/v1/ws/local-tools?token=${encodeURIComponent(token)}`)

    ws.onopen = () => {
      set({ connected: true, ws })
      const root = get().rootPath
      if (root) ws.send(JSON.stringify({ type: 'set_root', root }))
    }

    ws.onclose = () => {
      set({ connected: false, ws: null })
      // 5秒后重连
      setTimeout(() => get().connect(), 5000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'tool_request') {
          const result = await executeLocally(msg.tool, msg.args || {}, get().rootPath)
          ws.send(JSON.stringify({ type: 'tool_result', id: msg.id, result }))
        }
      } catch (e) {
        console.error('LocalProxy WS error:', e)
      }
    }

    set({ ws })
  },

  disconnect: () => {
    get().ws?.close()
    set({ connected: false, ws: null })
  },
}))
