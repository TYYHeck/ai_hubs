# AI Hubs 桌面客户端（Electron）

将 v4 后端（`backend/app`）与 Web 前端（`frontend/dist`）打包为桌面应用。
启动时自动拉起 Python 后端，并通过内置浏览器加载前端 SPA。

## 运行（开发模式）

```bash
# 1. 先构建前端
cd ../frontend && npm install && npm run build

# 2. 安装 Electron（首次）
cd electron && npm install

# 3. 启动桌面端（会自动启动后端并打开窗口）
npm start
```

应用默认连接 `http://127.0.0.1:8080`，后端由 Electron 进程自动拉起（见 `main.js` 的 `startBackend`）。

## 打包为可分发包

```bash
npm run dist:win     # Windows 安装包
npm run dist:mac     # macOS
npm run dist:linux   # Linux
```

产物位于 `electron/dist/`。

## 预打包 Python 后端（可选，进阶）

默认依赖系统已安装 Python 与后端依赖。若需完全离线分发，可使用
`pyinstaller` 将 `backend/app/main.py` 打包为可执行文件，并修改
`main.js` 中 `BACKEND_ENTRY` 指向该可执行文件。

## 说明

- `main.js`：主进程，负责启动后端、创建窗口、菜单与系统通知。
- `preload.js`：通过 `contextBridge` 暴露安全的桌面 API（窗口控制、文件对话框、通知）到 `window.aiHubsDesktop`。
- 后端绑定 `127.0.0.1`，仅本机访问，适合桌面场景。
