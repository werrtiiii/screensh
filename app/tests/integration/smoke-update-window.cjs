const {app,BrowserWindow,ipcMain}=require('electron'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();app.setPath('userData',path.resolve(__dirname,'../../.runtime-probe/update-window-profile-'+process.pid));app.on('window-all-closed',()=>{});
setTimeout(()=>{console.error('UPDATE_WINDOW_TEST_TIMEOUT');app.exit(1);},20000).unref();
const tick=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<100;i++){if(await fn())return;await tick(30);}throw Error('Update UI timeout');}
app.whenReady().then(async()=>{
 let window,release,checks=0,entered=0,state={currentVersion:'1.5.9',currentBuild:1,enabled:true,status:'idle'};
 const updates={get:()=>state,reportFailure:error=>{state={...state,status:'error',message:error.message};},prepareUpdate:async()=>{
  checks++;if(checks>1)return {enter:true};state={...state,status:'downloading',version:'1.5.9',build:2,downloadMode:'differential',percent:42,total:100000000,transferred:42000000};controller.send(state);await new Promise(r=>{release=r;});throw Error('测试连接失败，请重试');
 }};
 const controller=require('../../main/update-window.cjs').createUpdateWindow({BrowserWindow,ipcMain,updates,enter:()=>entered++,install:()=>{throw Error('No real installer may run in this test');},quit:()=>app.quit()});
 app.on('browser-window-created',(_event,w)=>{window=w;});controller.open(true);
 await wait(()=>release);await tick(100);
 const readCopy=()=>window.webContents.executeJavaScript("['title','version','detail','amount'].map(id=>document.getElementById(id).textContent)");
 assert.deepEqual(await readCopy(),['正在下载','当前版本 1.5.9','','42%']);
 controller.send({...state,downloadMode:'full'});
 await tick(50);assert.deepEqual(await readCopy(),['正在下载','当前版本 1.5.9','','42%']);assert.equal(entered,0);
 const dir=path.resolve(__dirname,'../../.runtime-probe/update-ui');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'download-light.png'),(await window.webContents.capturePage()).toPNG());
 await window.webContents.executeJavaScript("document.documentElement.dataset.theme='dark'");await tick(100);fs.writeFileSync(path.join(dir,'download-dark.png'),(await window.webContents.capturePage()).toPNG());
 release();await wait(()=>state.status==='error');await tick(50);assert.equal(await window.webContents.executeJavaScript("document.getElementById('enter').hidden"),false);assert.equal(entered,0);
 await window.webContents.executeJavaScript('window.updater.retry()');await window.webContents.executeJavaScript('void window.updater.enter(); true');await wait(()=>entered===1);
 controller.open(false);await wait(()=>entered===2);assert.equal(checks,3);console.log('STARTUP_GATE_MANUAL_RETRY_AND_THEMED_UI_OK');
 for(const name of ['updater-state','updater-retry','updater-enter','updater-close'])ipcMain.removeHandler(name);
 let quitting=false,handedOff=false;
 const handoff=require('../../main/update-window.cjs').createUpdateWindow({BrowserWindow,ipcMain,updates:{get:()=>({}),prepareUpdate:async()=>({install:true}),reportFailure:error=>{throw error;},cancel:()=>assert.fail('installer handoff cancelled')},enter(){},quit(){},canQuit:()=>quitting,install:async target=>{
  target.close();assert.equal(target.isDestroyed(),false,'manual close must be blocked during handoff');
  const closed=new Promise(resolve=>target.once('closed',resolve));quitting=true;target.close();await closed;assert.equal(target.isDestroyed(),true,'normal application quit must be allowed after handoff');handedOff=true;
 }});
 handoff.open(true);await wait(()=>handedOff);console.log('UPDATE_HANDOFF_CAN_QUIT_OK');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
