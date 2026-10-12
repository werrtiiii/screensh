const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  startEasyTier: (roomId, peers) => ipcRenderer.invoke('start-easytier', roomId, peers),
  testEasyTierPeer: peer => ipcRenderer.invoke('test-easytier-peer', peer),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('download-and-install-update'),
  onUpdateProgress: callback => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  getScreens: () => ipcRenderer.invoke('get-screens'),
  startSharing: config => ipcRenderer.invoke('start-sharing', config),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  leaveRuntime: () => ipcRenderer.invoke('leave-runtime'),
  onRuntimeError: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('runtime-error', listener);
    return () => ipcRenderer.removeListener('runtime-error', listener);
  },
});
