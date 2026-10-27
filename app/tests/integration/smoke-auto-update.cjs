// Real settings UI and IPC; update transport is simulated, never installs anything.
const {app,BrowserWindow,ipcMain}=require('electron');
const {EventEmitter}=require('node:events');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createAutoUpdate}=require('../../main/auto-update.cjs');
const root=path.resolve(__dirname,'../..'),data=path.join(root,'.runtime-probe','auto-update-'+process.pid);
app.disableHardwareAcceleration();app.setPath('userData',data);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  let win,releaseDownload;const client=new EventEmitter();let checks=0,downloads=0;
  client.checkForUpdates=async()=>{checks++;return {isUpdateAvailable:true,updateInfo:{version:'9.0.0',files:[{url:'ScreenSh-9.0.0-Setup.exe',size:200*1048576}]}};};
  client.downloadUpdate=async()=>{downloads++;client.emit('download-progress',{percent:50,total:4*1048576,transferred:2*1048576});await new Promise(resolve=>{releaseDownload=resolve;});client.emit('update-downloaded',{version:'9.0.0'});};
  const updates=createAutoUpdate({file:path.join(data,'updates.json'),packaged:true,currentVersion:'1.5.2',getUpdater:()=>client,pendingUpdates:{remember(){},restore:async()=>null},send:state=>win.webContents.send('update-state',state)});
  ipcMain.handle('get-update-settings',()=>updates.get());ipcMain.handle('set-auto-update',(_e,value)=>updates.set(value));
  ipcMain.handle('check-for-update',()=>updates.check());
  ipcMain.handle('get-hardware-acceleration',()=>false);ipcMain.handle('get-login-startup',()=>false);
  ipcMain.handle('lolping-get',()=>({config:{enabled:false}}));
  for(const name of ['lolping-sync','stop-sharing','leave-runtime','set-voice-timing'])ipcMain.handle(name,()=>{});
  const run=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{const until=Date.now()+10000;while(Date.now()<until){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('Update UI timeout: '+code);};
  try {
    win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:path.join(root,'preload.js'),offscreen:true,backgroundThrottling:false}});
    await win.loadFile(path.join(root,'renderer/index.html'));
    await run(`(async()=>{await import('./renderer.js');document.querySelector('#btnSettings').click();})()`);
    assert.equal(await run(`document.querySelector('#autoUpdateCheckbox').checked`),true);
    await run(`document.querySelector('#autoUpdateCheckbox').click()`);
    await wait(`!document.querySelector('#autoUpdateCheckbox').disabled`);assert.equal(updates.get().enabled,false);assert.equal(checks,0);
    await run(`document.querySelector('#btnCheckUpdate').click()`);await wait(`document.querySelector('#updateStatus').textContent.includes('9.0.0')`);
    assert.equal(checks,1);assert.equal(downloads,0);
    await win.reload();await wait(`!document.querySelector('#autoUpdateCheckbox').checked`);
    await run(`document.querySelector('#autoUpdateCheckbox').click()`);await wait(`document.querySelector('#updateStatus').textContent.includes('差分下载')`);
    assert.ok((await run(`document.querySelector('#updateStatus').textContent`)).includes('2.0 / 4.0 MB'));
    releaseDownload();await wait(`document.querySelector('#updateStatus').textContent.includes('已下载')`);
    assert.equal(downloads,1);assert.equal(client.autoInstallOnAppQuit,false);
    assert.ok((await run(`document.querySelector('#updateStatus').textContent`)).includes('下次启动时安装'));
    assert.equal(await run(`document.querySelector('#btnDownloadUpdate').textContent`),'立即安装');
    await run(`document.querySelector('#autoUpdateCheckbox').click()`);await wait(`!document.querySelector('#autoUpdateCheckbox').disabled`);
    assert.ok((await run(`document.querySelector('#updateStatus').textContent`)).includes('可点击立即安装'));
    await run(`document.querySelector('#btnSettings').click()`);await new Promise(resolve=>setTimeout(resolve,250));
    fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'settings.png'),(await win.webContents.capturePage()).toPNG());
    console.log('AUTO_UPDATE_UI_OK',JSON.stringify({defaultOn:true,persistentToggle:true,manualCheck:true,backgroundDownload:true,deferredInstall:true,screenshot:path.join(data,'settings.png')}));
  }catch(error){console.error(error.stack);process.exitCode=1;}
  finally{releaseDownload?.();updates.stop();win?.destroy();app.exit(process.exitCode||0);}
});
