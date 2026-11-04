const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('updater',{
  state:()=>ipcRenderer.invoke('updater-state'),retry:()=>ipcRenderer.invoke('updater-retry'),
  enter:()=>ipcRenderer.invoke('updater-enter'),close:()=>ipcRenderer.invoke('updater-close'),
  onState:callback=>ipcRenderer.on('update-state',(_event,state)=>callback(state)),
});
