const {contextBridge,ipcRenderer}=require('electron');
const action=data=>ipcRenderer.send('lolping-room-action',data);
contextBridge.exposeInMainWorld('panelApi',{
  on:fn=>{const listener=(_event,state)=>fn(state);ipcRenderer.on('lolping-room-state',listener);return()=>ipcRenderer.removeListener('lolping-room-state',listener);},
  act:a=>{if(!a)return;switch(a.t){case 'alive':action({type:'alive',who:a.peer});break;case 'mute':action({type:'block',who:a.peer,on:a.on});break;case 'kick':action({type:'vote',kind:'kick',target:a.peer});break;case 'vote':action({type:'vote',kind:a.kind});break;case 'ballot':action({type:'ballot',yes:a.yes});break;}}
});
let request=0;
contextBridge.exposeInMainWorld('textApi',{
  strings:()=>Promise.resolve({placeholder:'对房间说点什么，Enter 发送',hint:'指令：/ff /noff /ready',unknown:'未知指令',votesOff:'投票已关闭'}),
  cancel:()=>action({type:'close'}),
  submit:text=>new Promise(resolve=>{const id=++request;const response=(_event,data)=>{if(data.id!==id)return;ipcRenderer.removeListener('lolping-text-answer',response);resolve(data.answer);};ipcRenderer.on('lolping-text-answer',response);action({type:'text',text,request:id});})
});
