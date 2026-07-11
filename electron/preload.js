// AI Hubs Desktop — Preload 脚本
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('aiHubsDesktop', {
  // 平台信息
  platform: process.platform,

  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // 文件操作
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),

  // 本地 IDE：直接读写本机文件系统 + 本地运行脚本
  ide: {
    pickFolder: () => ipcRenderer.invoke('ide:pickFolder'),
    tree: (root) => ipcRenderer.invoke('ide:tree', root),
    readFile: (abs) => ipcRenderer.invoke('ide:readFile', abs),
    writeFile: (abs, content) => ipcRenderer.invoke('ide:writeFile', abs, content),
    mkdir: (abs) => ipcRenderer.invoke('ide:mkdir', abs),
    delete: (abs) => ipcRenderer.invoke('ide:delete', abs),
    join: (root, rel) => ipcRenderer.invoke('ide:join', root, rel),
    run: (abs, args) => ipcRenderer.invoke('ide:run', abs, args),
  },

  // 系统通知
  notify: (title, body) => {
    ipcRenderer.send('notify', { title, body });
  },
});
