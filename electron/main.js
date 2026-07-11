// AI Hubs Desktop — Electron 主进程
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let backendProcess = null;

// 后端端口需与 config.yaml 的 server.port 保持一致（默认 8080）
const BACKEND_PORT = 8080;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

const REPO_URL = 'https://github.com/TYYHeck/ai_hubs';

// v4 后端入口（backend/app/main.py 提供 Web + API 一体的 FastAPI 服务）
const BACKEND_ENTRY = path.join(__dirname, '..', 'backend', 'app', 'main.py');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'AI Hubs',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // macOS
    titleBarStyle: 'hiddenInset',
    // Windows
    frame: process.platform !== 'darwin',
  });

  // 加载前端
  mainWindow.loadURL(BACKEND_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 自定义菜单
  const menuTemplate = [
    {
      label: 'AI Hubs',
      submenu: [
        { label: '关于 AI Hubs', click: () => showAbout() },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '文档', click: () => shell.openExternal(`${REPO_URL}`) },
        { label: '报告问题', click: () => shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 AI Hubs',
    message: 'AI Hubs v4.0',
    detail: '新一代智能 Agent 平台\n\n多端支持 · 技能市场 · 智能记忆 · 内置IDE',
  });
}

// 使用 spawn 启动 Python 后端（fork 仅适用于 Node.js 模块，不能用于 python）
// 跨平台：Windows 上命令是 python，linux/mac 上通常是 python3
function startBackend() {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  backendProcess = spawn(pythonCmd, [BACKEND_ENTRY, '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Backend] 进程退出, 代码: ${code}`);
    if (code !== 0 && code !== null) {
      dialog.showErrorBox('后端错误', `AI Hubs 后端异常退出 (${code})`);
    }
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

// ── IPC：窗口控制（供 preload 调用）──
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// ── IPC：文件对话框 ──
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});
ipcMain.handle('dialog:saveFile', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'untitled',
  });
  if (result.canceled) return null;
  return result.filePath;
});

// 供渲染进程触发的系统通知
ipcMain.on('notify', (event, { title, body }) => {
  new Notification({ title, body }).show();
});

// ── 应用生命周期 ──
app.whenReady().then(() => {
  startBackend();
  // 等待后端启动
  setTimeout(createWindow, 3000);
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
