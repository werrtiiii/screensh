const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getSourceById: (sourceId) => ipcRenderer.invoke('get-source-by-id', sourceId),

  // 方案 B 管道数据与信令隔离桥接
  startWindowAudio: (sourceId) => ipcRenderer.send('start-window-audio-capture', sourceId),
  stopWindowAudio: () => ipcRenderer.send('stop-window-audio-capture'),
  onWindowAudioData: (callback) => ipcRenderer.on('window-audio-data', (event, data) => callback(data)),
  removeWindowAudioListener: () => ipcRenderer.removeAllListeners('window-audio-data'),

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close')
});
