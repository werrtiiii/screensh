const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getLolPing: id => ipcRenderer.invoke('lolping-get', id),
  saveLolPing: (id, config) => ipcRenderer.invoke('lolping-save', id, config),
  syncLolPing: context => ipcRenderer.invoke('lolping-sync', context),
  previewLolPing: (kind,id) => ipcRenderer.invoke('lolping-preview',kind,id),
  suspendLolPingInput: on => ipcRenderer.invoke('lolping-input-suspend',on),
  onLolPingStatus: callback => { const fn = (_event, data) => callback(data); ipcRenderer.on('lolping-status', fn); return () => ipcRenderer.removeListener('lolping-status', fn); },
  voiceDevices: () => ipcRenderer.invoke('voice-devices'),
  voiceStart: deviceId => ipcRenderer.invoke('voice-start', deviceId),
  voiceStop: () => ipcRenderer.invoke('voice-stop'),
  accompanimentStart: sourceId => ipcRenderer.invoke('accompaniment-start', sourceId),
  accompanimentStop: () => ipcRenderer.invoke('accompaniment-stop'),
  accompanimentSources: () => ipcRenderer.invoke('accompaniment-sources'),
  onAccompanimentPCM: callback => { const handler = (_event, data) => callback(data); ipcRenderer.on('accompaniment-pcm', handler); return () => ipcRenderer.removeListener('accompaniment-pcm', handler); },
  onAccompanimentError: callback => { const handler = (_event, message) => callback(message); ipcRenderer.on('accompaniment-error', handler); return () => ipcRenderer.removeListener('accompaniment-error', handler); },
  onVoiceError: callback => { const fn = (_event, message) => callback(message); ipcRenderer.on('voice-error', fn); return () => ipcRenderer.removeListener('voice-error', fn); },
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  startEasyTier: (roomId, peers) => ipcRenderer.invoke('start-easytier', roomId, peers),
  testEasyTierPeer: peer => ipcRenderer.invoke('test-easytier-peer', peer),
  pingMember: ip => ipcRenderer.invoke('ping-member', ip),
  getSavedServerPassword: (url, id) => ipcRenderer.invoke('get-saved-server-password', url, id),
  saveServerPassword: (url, id, password) => ipcRenderer.invoke('save-server-password', url, id, password),
  getLoginStartup: () => ipcRenderer.invoke('get-login-startup'),
  setLoginStartup: enabled => ipcRenderer.invoke('set-login-startup', enabled),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('download-and-install-update'),
  getHardwareAcceleration: () => ipcRenderer.invoke('get-hardware-acceleration'),
  setHardwareAcceleration: enabled => ipcRenderer.invoke('set-hardware-acceleration', enabled),
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
