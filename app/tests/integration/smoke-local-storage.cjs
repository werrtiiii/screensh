const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../.runtime-probe/local-storage-browser-check'),legacy=path.join(root,'legacy'),phase=process.env.SCREENSH_STORAGE_PHASE;
fs.mkdirSync(legacy,{recursive:true});app.setPath('userData',legacy);app.setPath('sessionData',legacy);app.disableHardwareAcceleration();
if(phase==='seed')fs.writeFileSync(path.join(root,'page.html'),'<html><body>storage migration fixture</body></html>');
if(phase==='verify'){
  const adapter={isPackaged:true,getName:()=>app.getName(),getPath:key=>key==='exe'?path.join(root,'installation/ScreenSh.exe'):app.getPath(key),setPath:(...args)=>app.setPath(...args),setAppLogsPath:p=>app.setAppLogsPath(p),requestSingleInstanceLock:()=>app.requestSingleInstanceLock()};
  const result=require('../../main/local-storage.cjs').configureLocalStorage(adapter);assert.equal(result.hasLock,true);assert.equal(app.getPath('userData'),path.join(root,'installation/data/user-data'));
}
app.whenReady().then(async()=>{let win;try{
  win=new BrowserWindow({show:false});await win.loadFile(path.join(root,'page.html'));
  if(phase==='seed')await win.webContents.executeJavaScript(`(async()=>{localStorage.setItem('storage-fixture','settings');await new Promise((resolve,reject)=>{const r=indexedDB.open('storage-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('chat');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('chat','readwrite');tx.objectStore('chat').put('saved chat history','message');tx.oncomplete=()=>{db.close();resolve();};};});})()`);
  else{
    const value=await win.webContents.executeJavaScript(`(async()=>({settings:localStorage.getItem('storage-fixture'),chat:await new Promise((resolve,reject)=>{const r=indexedDB.open('storage-fixture',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('chat'),get=tx.objectStore('chat').get('message');get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};})}))()`);
    assert.deepEqual(value,{settings:'settings',chat:'saved chat history'});console.log('CHROMIUM_SETTINGS_AND_CHAT_MIGRATED');
  }
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}});
