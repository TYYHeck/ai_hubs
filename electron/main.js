// AI Hubs Desktop — Electron 主进程
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { spawn } = require('child_process');

let mainWindow = null;
let backendProcess = null;

// 后端端口需与 config.yaml 的 server.port 保持一致（默认 8080）
const BACKEND_PORT = 8080;

// 加载地址：
//   - 默认连线上服务器（后端已常驻，桌面端开箱即用，无需本机装 Python）。
//   - 可用环境变量 AI_HUBS_URL 覆盖，如 http://localhost:8080 走本机全栈。
const AI_HUBS_URL = process.env.AI_HUBS_URL || 'http://8.138.24.27/';
// 仅当加载本机地址时才拉起本地后端；连服务器时不需要。
const USE_LOCAL_BACKEND = /localhost|127\.0\.0\.1/.test(AI_HUBS_URL);

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

  // 加载前端（默认线上服务器，可用 AI_HUBS_URL 覆盖为本机全栈）
  mainWindow.loadURL(AI_HUBS_URL);

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

// ── IPC：本地 IDE（直接操作本机文件系统 + 本地运行）──
const LOCAL_RUN_TIMEOUT = 30000; // 毫秒
// 脚本型语言
const LOCAL_INTERPRETERS = {
  '.py': process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'],
  '.js': ['node'],
  '.mjs': ['node'],
  '.sh': ['bash'],
  '.pl': ['perl'],
};
// 编译型语言：先编译再运行
const LOCAL_COMPILE_LANGS = {
  '.c': {
    compilers: ['gcc'],
    build: (src, out) => ['gcc', src, '-o', out, '-lm'],
    run: (out, args) => [out, ...args],
  },
  '.cpp': {
    compilers: ['g++'],
    build: (src, out) => ['g++', src, '-o', out, '-std=c++17'],
    run: (out, args) => [out, ...args],
  },
  '.cc': {
    compilers: ['g++'],
    build: (src, out) => ['g++', src, '-o', out, '-std=c++17'],
    run: (out, args) => [out, ...args],
  },
  '.cxx': {
    compilers: ['g++'],
    build: (src, out) => ['g++', src, '-o', out, '-std=c++17'],
    run: (out, args) => [out, ...args],
  },
  '.java': {
    compilers: ['javac'],
    build: (src, out) => ['javac', '-d', path.dirname(out), src],
    run: (out, args) => ['java', '-cp', path.dirname(out), path.basename(out, '.java'), ...args],
  },
};
// 构建目录树时跳过的大目录（避免卡死）
const IDE_IGNORE_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.idea', '.vscode', '.next', 'target',
]);

function ideBuildTree(abs, depth = 0, maxDepth = 8) {
  const name = path.basename(abs);
  let stat;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (stat.isFile()) {
    return { name, path: abs, type: 'file', size: stat.size };
  }
  const node = { name, path: abs, type: 'dir', children: [] };
  if (depth >= maxDepth) { node.truncated = true; return node; }
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return node; }
  entries.sort((a, b) => (a.isFile() ? 1 : 0) - (b.isFile() ? 1 : 0) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isDirectory() && (IDE_IGNORE_DIRS.has(e.name) || e.name.startsWith('.'))) continue;
    const child = ideBuildTree(path.join(abs, e.name), depth + 1, maxDepth);
    if (child) node.children.push(child);
  }
  return node;
}

// 选择本地工作文件夹
ipcMain.handle('ide:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('ide:tree', async (_e, root) => {
  if (!root) return null;
  return ideBuildTree(root);
});

ipcMain.handle('ide:readFile', async (_e, abs) => {
  const content = await fsp.readFile(abs, 'utf-8');
  const stat = await fsp.stat(abs);
  return { path: abs, name: path.basename(abs), content, size: stat.size };
});

ipcMain.handle('ide:writeFile', async (_e, abs, content) => {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content ?? '', 'utf-8');
  const stat = await fsp.stat(abs);
  return { path: abs, name: path.basename(abs), size: stat.size };
});

ipcMain.handle('ide:mkdir', async (_e, abs) => {
  await fsp.mkdir(abs, { recursive: true });
  return { path: abs, type: 'dir' };
});

ipcMain.handle('ide:delete', async (_e, abs) => {
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) await fsp.rm(abs, { recursive: true, force: true });
  else await fsp.unlink(abs);
  return { ok: true };
});

ipcMain.handle('ide:join', async (_e, root, rel) => path.join(root, rel));

// 本地运行脚本 / 编译型语言，输出返回渲染进程
function localSpawn(cmd, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env } });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: `启动失败: ${err.message}`, code: -1, cmd: cmd.join(' ') });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, LOCAL_RUN_TIMEOUT);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `启动失败: ${err.message}`, code: -1, cmd: cmd.join(' ') });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut,
        stdout,
        stderr: timedOut ? `执行超时（>${LOCAL_RUN_TIMEOUT / 1000}s），已终止。\n${stderr}` : stderr,
        code: code ?? -1,
        cmd: cmd.join(' '),
      });
    });
  });
}

ipcMain.handle('ide:run', async (_e, abs, args = []) => {
  const ext = path.extname(abs).toLowerCase();
  const workdir = path.dirname(abs);

  // 编译型语言
  if (LOCAL_COMPILE_LANGS[ext]) {
    const spec = LOCAL_COMPILE_LANGS[ext];
    const compiler = spec.compilers.find((c) => { try { return !!spawn.sync(c, ['--version'], { stdio: 'ignore' }); } catch { return false; } });
    if (!compiler) {
      return { stdout: '', stderr: `未找到编译器: ${spec.compilers.join(' / ')}（请先安装）`, exit_code: -1, timed_out: false, command: '' };
    }
    const out = abs.slice(0, abs.length - ext.length); // 去掉扩展名
    const buildCmd = spec.build(abs, out);
    const build = await localSpawn(buildCmd, workdir);
    if (!build.ok || build.code !== 0) {
      return { stdout: build.stdout, stderr: build.stderr || '（编译失败）', exit_code: build.code, timed_out: false, command: build.cmd };
    }
    const runCmd = spec.run(out, args);
    const run = await localSpawn(runCmd, workdir);
    return { stdout: run.stdout, stderr: run.stderr, exit_code: run.code, timed_out: false, command: `${build.cmd} && ${run.cmd}` };
  }

  // 脚本型语言
  const candidates = LOCAL_INTERPRETERS[ext];
  if (!candidates) {
    const supported = [...Object.keys(LOCAL_INTERPRETERS), ...Object.keys(LOCAL_COMPILE_LANGS)].join(', ');
    return {
      stdout: '', stderr: `不支持的文件类型 ${ext}，仅支持: ${supported}`,
      exit_code: -1, timed_out: false, command: '',
    };
  }
  const exe = candidates[0];
  const r = await localSpawn([exe, abs, ...args], workdir);
  return { stdout: r.stdout, stderr: r.stderr, exit_code: r.code, timed_out: false, command: r.cmd };
});

// 供渲染进程触发的系统通知
ipcMain.on('notify', (event, { title, body }) => {
  new Notification({ title, body }).show();
});

// ── 应用生命周期 ──
app.whenReady().then(() => {
  if (USE_LOCAL_BACKEND) {
    // 本机全栈模式：拉起本地后端，等待启动后开窗
    startBackend();
    setTimeout(createWindow, 3000);
  } else {
    // 连线上服务器：无需本地后端，直接开窗
    createWindow();
  }
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
