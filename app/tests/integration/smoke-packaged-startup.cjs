// Execute the real packaged main entry with production paths, but only a fresh
// isolated profile. No installation, user profile or existing client is changed.
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path');
const bundle=path.resolve(process.env.SCREENSH_TEST_BUNDLE||path.join(__dirname,'../../dist/win-unpacked')),resources=path.join(bundle,'resources'),archive=path.join(resources,'app.asar');
const root=path.resolve(__dirname,'../../.runtime-probe/packaged-startup-'+process.pid),profile=path.join(root,'legacy');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(path.join(root,'installation'),{recursive:true});
fs.writeFileSync(path.join(profile,'auto-update.json'),JSON.stringify({enabled:process.env.SCREENSH_TEST_STARTUP_AUTO==='true'}));app.setPath('userData',profile);app.setPath('sessionData',profile);
const failedUpdate=process.env.SCREENSH_TEST_FAILED_UPDATE==='true';
const version=failedUpdate?'99.0.0':JSON.parse(fs.readFileSync(path.join(archive,'package.json'),'utf8')).version,fileName=`ScreenSh-${version}-Setup.exe`,bytes=Buffer.from('isolated startup fixture, never executed');
const sha512=require('node:crypto').createHash('sha512').update(bytes).digest('base64'),oldCache=path.join(root,'old-cache/screensh-updater');fs.mkdirSync(path.join(oldCache,'pending'),{recursive:true});fs.writeFileSync(path.join(oldCache,'pending',fileName),bytes);fs.writeFileSync(path.join(oldCache,'installer.exe'),'previous installer');fs.writeFileSync(path.join(oldCache,'pending/update-info.json'),JSON.stringify({fileName,sha512}));fs.writeFileSync(path.join(profile,'auto-update.json.pending'),JSON.stringify({version,fileName,sha512}));
if(failedUpdate)fs.writeFileSync(path.join(profile,'auto-update.json.pending.install-attempt'),JSON.stringify({fileName,sha512}));
Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:resources});
const getPath=app.getPath.bind(app);app.getPath=key=>key==='exe'?path.join(root,'installation/ScreenSh.exe'):getPath(key);
app.getVersion=()=>JSON.parse(fs.readFileSync(path.join(archive,'package.json'),'utf8')).version;
require(path.join(archive,'node_modules/electron-updater/out/AppAdapter')).getAppCacheDir=()=>path.join(root,'old-cache');
require(path.join(archive,'node_modules/electron-updater/out/NsisUpdater')).NsisUpdater.prototype.checkForUpdates=async()=>({isUpdateAvailable:failedUpdate,updateInfo:{version}});
dialog.showErrorBox=(title,message)=>{console.error('STARTUP_DIALOG',title,message);app.exit(1);};
if(failedUpdate){dialog.showMessageBox=async()=>({response:0});require(path.join(archive,'node_modules/electron-updater/out/NsisUpdater')).NsisUpdater.prototype.quitAndInstall=()=>{throw Error('Repeated automatic installation must not happen');};}
process.on('unhandledRejection',error=>{console.error('STARTUP_REJECTION',error);app.exit(1);});
const guard=setTimeout(()=>{console.error('PACKAGED_STARTUP_TIMEOUT');app.exit(1);},15000);
app.on('browser-window-created',(_event,win)=>{
  win.webContents.once('did-finish-load',async()=>{
    try{
      if(win.webContents.getURL().endsWith('/updater.html')){
        if(failedUpdate){for(let i=0;i<60;i++){if(await win.webContents.executeJavaScript("document.getElementById('title').textContent==='更新未完成'"))break;await new Promise(r=>setTimeout(r,30));}await win.webContents.executeJavaScript('void window.updater.enter(); true');}return;
      }
      const state=await win.webContents.executeJavaScript(`(async()=>{await import('./renderer.js');await window.electronAPI.confirmStartup();return window.electronAPI.getUpdateSettings();})()`);if(failedUpdate){require('node:assert/strict').equal(state.installFailed,true);require('node:assert/strict').equal(fs.existsSync(path.join(root,'installation/data/updates/pending',fileName)),true);console.log('PACKAGED_FAILED_UPDATE_OPENS_UI_WITHOUT_REINSTALL');}else{require('node:assert/strict').deepEqual(fs.readFileSync(path.join(root,'installation/data/updates/installer.exe')),bytes);require('node:assert/strict').equal(fs.existsSync(path.join(root,'installation/data/updates/pending',fileName)),false);console.log('PACKAGED_MAIN_RENDERER_AND_UPDATE_CLEANUP_READY');}clearTimeout(guard);app.quit();setTimeout(()=>app.exit(0),3000).unref();}
    catch(error){console.error('PACKAGED_RENDERER_FAILED',error);app.exit(1);}
  });
});
try{require(path.join(archive,'main.js'));}catch(error){console.error('PACKAGED_ENTRY_FAILED',error);app.exit(1);}
