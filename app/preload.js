const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口管理
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // EasyTier & MediaMTX & OBS 控制
  startEasyTier: (roomId) => ipcRenderer.invoke('start-easytier', roomId),
  stopEasyTier: () => ipcRenderer.send('stop-easytier'),
  startMediaMTX: () => ipcRenderer.send('start-mediamtx'),
  stopMediaMTX: () => ipcRenderer.send('stop-mediamtx'),

  // 新增：获取显示器列表
  getScreens: () => ipcRenderer.invoke('get-screens'),

  // 修改：接收动态配置参数
  startOBSWhip: (config) => ipcRenderer.send('start-obs-whip', config),
  stopOBSWhip: () => ipcRenderer.send('stop-obs-whip'),
});
