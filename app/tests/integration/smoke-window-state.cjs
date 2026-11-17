const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createWindowState}=require('../../main/window-state.cjs');
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const root=path.resolve(__dirname,'../..'),file=path.join(root,'.runtime-probe','window-state-'+process.pid+'.json');
app.whenReady().then(async()=>{
 let win;
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await pause(40);}throw Error('Window state timeout');};
 const create=async store=>{
   const saved=store.read();win=new BrowserWindow({...saved.bounds,minWidth:960,minHeight:640,frame:false,show:false});win.setBounds(saved.bounds);store.track(win);
   await win.loadURL('data:text/html,<title>Window state test</title>');win.showInactive();if(saved.maximized)win.maximize();await pause(100);
 };
 try{
   const store=createWindowState({file,screen});await create(store);
   const area=screen.getDisplayMatching(win.getBounds()).workArea;
   const bounds={x:area.x+20,y:area.y+20,width:1000,height:660};win.setBounds(bounds);await pause(100);
   const actual=win.getBounds();win.close();await wait(()=>win.isDestroyed());
   await create(store);assert.deepEqual(win.getBounds(),actual,'restores the previously closed window bounds');
   const normal=win.getNormalBounds();win.maximize();await wait(()=>win.isMaximized());
   win.minimize();await wait(()=>win.isMinimized());win.close();await wait(()=>win.isDestroyed());
   assert.equal(store.read().maximized,true,'minimizing a maximized window does not erase the maximized preference');
   await create(store);await wait(()=>win.isMaximized());win.unmaximize();await wait(()=>!win.isMaximized());await pause(100);
   assert.deepEqual(win.getNormalBounds(),normal,'restoring from maximized keeps the normal window size');
   console.log('WINDOW_STATE_OK normal bounds, maximize, minimized exit, restore');
 }catch(error){console.error(error.stack,error.actual,error.expected);process.exitCode=1;}
 finally{win?.destroy();fs.rmSync(file,{force:true});app.exit(process.exitCode||0);}
});
