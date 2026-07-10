// AI Hubs Desktop — Electron 主进程
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let backendProcess = null;

const BACKEND_PORT = 8001;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

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
        { label: '文档', click: () => shell.openExternal('https://github.com/your-repo/ai-hubs') },
        { label: '报告问题', click: () => shell.openExternal('https://github.com/your-repo/ai-hubs/issues') },
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
    message: 'AI Hubs v3.0',
    detail: '新一代智能 Agent 平台\n\n多端支持 · 技能市场 · 智能记忆 · 内置IDE',
  });
}

function startBackend() {
  // 启动 Python 后端服务
  const pythonScript = path.join(__dirname, '..', 'main.py');
  backendProcess = fork(pythonScript, ['--web'], {
    env: { ...process.env },
    silent: true,
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Backend] 进程退出, 代码: ${code}`);
    if (code !== 0) {
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

// ── 应用生命周期 ──

app.whenReady().then(() => {
  startBackend();
  // 等待后端启动
  setTimeout(createWindow, 2000);
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
