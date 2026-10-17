const path=require('node:path');
const {BrowserWindow,ipcMain,screen}=require('electron');
// ScreenSh owns lifecycle/IPC; pages, artwork, videos and audio are lolPing's originals.
class LolPingWindows {
  constructor({action,editing}) {
    Object.assign(this,{action,editing});this.windows=new Map();this.visible=new Set();this.point=null;
    this.listener=(event,data)=>{
      const entry=[...this.windows].find(([,w])=>w.webContents===event.sender);
      if(!entry||!data||typeof data.type!=='string')return;
      const mode=entry[0];
      if(mode==='text'&&data.type==='text'){
        const answer=this.action(data,mode)||'unknown';
        if(!event.sender.isDestroyed())event.sender.send('lolping-text-answer',{id:data.request,answer});
        if(answer==='sent')this.hide('text');
      } else this.action(data,mode);
    };
    ipcMain.on('lolping-room-action',this.listener);
  }
  placement(mode) {
    const area=(mode==='vote'?screen.getPrimaryDisplay():screen.getDisplayNearestPoint(this.point||screen.getCursorScreenPoint())).workArea;
    const ready=this.state?.vote?.kind==='ready';
    const size=mode==='text'?{width:420,height:64}:mode==='vote'?(ready?{width:442,height:452}:{width:223,height:113}):{width:720,height:470};
    const width=Math.min(size.width,area.width),height=Math.min(size.height,area.height);
    let x=area.x+Math.round((area.width-width)/2),y=area.y+Math.round((area.height-height)/2);
    if(mode==='vote'&&!ready){x=area.x+area.width-width-16;y=area.y+Math.round(area.height*.4);}
    if(mode==='text'){x=this.point.x;y=this.point.y;}
    return {width,height,x:Math.max(area.x,Math.min(x,area.x+area.width-width)),y:Math.max(area.y,Math.min(y,area.y+area.height-height))};
  }
  panelState(mode) {
    const s=this.state;
    return {view:mode==='vote'?'vote':'roster',lang:'zh-CN',max:Math.max(16,s.members.length),
      room:{phase:'active',code:null,lan:'ok',internet:'off',lonely:false,clockSkew:false,members:s.members.map(m=>({peer:m.id,name:m.name,self:m.id===s.self,color:0,rgb:null,path:m.presence||m.id===s.self?'lan':'connecting',status:m.presence?.paused?'paused':m.presence?.muted?'muted':'on',needsUpdate:false,noEmotes:false,noChat:false,textOff:m.presence?.textOn===false,votesOff:m.presence?.votesOn===false,muted:m.blocked}))},
      history:s.history.map(h=>({kind:h.kind||'text',at:h.at,text:h.text,tag:h.tag||null})),vote:s.vote,voteOver:!!s.voteOver,textOn:s.features.rooms&&s.features.roomText,votesOn:s.features.rooms&&s.features.roomVotes,volume:s.volume};
  }
  push(mode,w) {if(mode!=='text'&&!w.isDestroyed()&&!w.webContents.isLoadingMainFrame()&&this.state)w.webContents.send('lolping-room-state',this.panelState(mode));}
  create(mode) {
    let win=this.windows.get(mode);if(win&&!win.isDestroyed())return win;
    win=new BrowserWindow({...this.placement(mode),frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,show:false,alwaysOnTop:true,skipTaskbar:true,focusable:mode==='text',webPreferences:{preload:path.join(__dirname,'lolping/dist/ui/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,autoplayPolicy:'no-user-gesture-required'}});
    this.windows.set(mode,win);win.setAlwaysOnTop(true,'screen-saver');win.setVisibleOnAllWorkspaces(true);
    win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('did-finish-load',()=>{if(this.visible.has(mode)){this.push(mode,win);if(mode==='text')this.focusText(win);else win.showInactive();}});
    win.webContents.on('did-fail-load',()=>{if(!win.isDestroyed())win.destroy();});
    win.webContents.on('render-process-gone',()=>{if(!win.isDestroyed())win.destroy();});
    if(mode==='text'){let focused=false;win.on('focus',()=>{focused=true;});win.on('blur',()=>{if(focused)this.hide('text');});}
    win.on('closed',()=>{if(this.windows.get(mode)===win)this.windows.delete(mode);if(mode==='text')this.editing(false);});
    win.loadFile(path.join(__dirname,`lolping/dist/renderer/${mode==='text'?'text':'panel'}/index.html`));
    return win;
  }
  update(state) {this.state=state;for(const [mode,w]of this.windows)if(this.visible.has(mode))this.push(mode,w);if(!state.vote)this.hide('vote');}
  focusText(w) {w.show();w.focus();clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>{if(!w.isDestroyed()&&this.visible.has('text')&&!w.isFocused())this.hide('text');},2000);this.focusTimer.unref?.();}
  show(mode) {this.visible.add(mode);if(mode==='text'){this.editing(true);this.point=screen.getCursorScreenPoint();}const w=this.create(mode);w.setBounds(this.placement(mode));if(!w.webContents.isLoading()){this.push(mode,w);if(mode==='text')this.focusText(w);else{w.setAlwaysOnTop(true,'screen-saver');w.showInactive();}}}
  hide(mode) {
    this.visible.delete(mode);const w=this.windows.get(mode);
    if(w&&!w.isDestroyed()){
      if(mode==='text')w.destroy();else {if(mode==='vote'&&this.state)w.webContents.send('lolping-room-state',{...this.panelState(mode),vote:null,voteOver:false});w.hide();}
    }
    if(mode==='text'){clearTimeout(this.focusTimer);this.editing(false);}
  }
  close() {clearTimeout(this.focusTimer);ipcMain.removeListener('lolping-room-action',this.listener);for(const w of this.windows.values())if(!w.isDestroyed())w.destroy();this.windows.clear();this.editing(false);}
}
module.exports={LolPingWindows};
