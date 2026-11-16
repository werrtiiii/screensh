// Regression checks for five previously reproduced bugs. No real installation is changed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{spawnSync}=require('node:child_process');
const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');
const {createPendingUpdate}=require('../../main/pending-update.cjs');
const {createAutoUpdate}=require('../../main/auto-update.cjs');
const {createUpdateWindow}=require('../../main/update-window.cjs');
const directory=path.resolve(__dirname,'../../.runtime-probe/updater-audit-'+crypto.randomUUID());fs.mkdirSync(directory,{recursive:true});
const findings=[];
const logger={info(){},warn(){},error(){}};
async function pendingFixture(name){
  const root=path.join(directory,name),cache=path.join(root,'data/updates'),file=path.join(root,'data/user-data/auto-update.json.pending');
  const helper=new DownloadedUpdateHelper(cache),filename='ScreenSh-9.0.0-Update.zip',installer=path.join(helper.cacheDirForPendingUpdate,filename);
  fs.mkdirSync(path.dirname(installer),{recursive:true});fs.writeFileSync(installer,'checksum fixture');
  const sha512=crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
  await helper.setDownloadedFile(installer,null,{version:'9.0.0'},{info:{url:filename,sha512}},filename,true);
  const pending=createPendingUpdate({file}),updater={downloadedUpdateHelper:helper,getOrCreateDownloadHelper:async()=>helper};pending.remember(updater,{version:'9.0.0'});
  return {root,cache,file,helper,installer,pending,updater};
}
async function manualOverwrite(){
  const f=await pendingFixture('manual-overwrite');fs.writeFileSync(path.join(f.cache,'installer.exe'),'old setup baseline');
  await f.pending.confirmInstalled(f.updater,'10.0.0');
  assert.equal(fs.existsSync(f.installer),false);assert.equal(fs.existsSync(path.join(f.cache,'installer.exe')),false);
  findings.push({id:'old-cache-after-manual-upgrade',passed:true,detail:'Healthy manual upgrade removes older packages and baselines.'});
}
async function interruptedCleanup(){
  const f=await pendingFixture('cleanup-retry'),remove=fs.promises.unlink,metadata=path.join(f.helper.cacheDirForPendingUpdate,'update-info.json');
  fs.promises.unlink=async target=>{if(target===metadata)throw Object.assign(Error('metadata busy'),{code:'EBUSY'});return remove.call(fs.promises,target);};
  try{await assert.rejects(f.pending.confirmInstalled(f.updater,'9.0.0'),/metadata busy/);}finally{fs.promises.unlink=remove;}
  assert.equal(fs.existsSync(f.installer),false);assert.ok(fs.existsSync(metadata));
  await f.pending.confirmInstalled(f.updater,'9.0.0');assert.equal(fs.existsSync(metadata),false);
  findings.push({id:'cleanup-retry-after-package-deletion',passed:true,detail:'A retry completes cleanup even when the archive was already removed.'});
}
async function closedWindow(){
  const handlers=new Map(),windows=[];let finish,installCalls=0,closedTarget=false,lastError;
  class Window extends EventEmitter{
    constructor(){super();this.webContents=new EventEmitter();this.webContents.send=()=>{};windows.push(this);}
    isDestroyed(){return this.destroyed===true;}show(){}destroy(){this.destroyed=true;this.emit('closed');}loadFile(){return Promise.resolve();}
  }
  const state={};const updates={get:()=>state,cancel:async()=>{},prepareUpdate:()=>new Promise(resolve=>{finish=resolve;}),reportFailure:error=>{lastError=error.message;}};
  const controller=createUpdateWindow({BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},updates,enter(){},quit(){},install:async window=>{installCalls++;closedTarget=window===null;if(!window)throw Error('Installer has no update window');}});
  controller.open(true);windows[0].webContents.emit('did-finish-load');await new Promise(resolve=>setImmediate(resolve));
  handlers.get('updater-close')({sender:windows[0].webContents});finish({install:true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(installCalls,0);assert.equal(closedTarget,false);assert.equal(lastError,undefined);
  findings.push({id:'manual-close-keeps-update-running',passed:true,detail:'A closed updater never installs or misreports a late completion.'});
}
async function lostResume(){
  const {AppUpdater}=require('electron-updater/out/AppUpdater'),{CancellationToken}=require('builder-util-runtime');
  const helper=new DownloadedUpdateHelper(path.join(directory,'resume/data/updates')),stage=path.join(require('../../main/update-blocks.cjs').stageDirectory(helper.cacheDirForPendingUpdate,Buffer.from(JSON.stringify({version:'9.0.0'}))),'first.dll.payload');
  const fake=new EventEmitter();fake._logger=logger;fake.getOrCreateDownloadHelper=async()=>helper;
  const info={url:'ScreenSh-9.0.0-Update.json',sha512:'A'.repeat(86)+'=='};
  await assert.rejects(AppUpdater.prototype.executeDownload.call(fake,{fileExtension:'json',fileInfo:{info,url:new URL('https://github.com/o/r/releases/download/9.0.0/'+info.url)},downloadUpdateOptions:{cancellationToken:new CancellationToken(),updateInfoAndProvider:{info:{version:'9.0.0'}}},done:async()=>{},task:async destination=>{
    fs.writeFileSync(destination,'manifest');fs.mkdirSync(path.dirname(stage),{recursive:true});fs.writeFileSync(stage,'verified first downloaded file');throw Error('second file network interruption');
  }}),/network interruption/);
  assert.equal(fs.existsSync(stage),true);
  findings.push({id:'network-failure-discards-incremental-progress',passed:true,detail:'Verified checkpoints survive the real downloader pending reset.'});
}
async function backupCleanup(){
  const appRoot=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(__dirname,'check-portable-update.ps1'),'utf8');
  const lockedConfirm='foreach(var dir in Directory.GetDirectories(Path.Combine(root,"data","updates","transactions"))){var file=Path.Combine(dir,"backup","resources","obsolete.txt");using(var held=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.Read)){File.WriteAllText(Path.Combine(dir,"confirmed"),"9.0.0");System.Threading.Thread.Sleep(2500);}}';
  const script=source.replace(/^\$appRoot=.*$/m,"$appRoot='"+appRoot.replaceAll("'","''")+"'")
    .replace(/^foreach\(\$scenario in @\(.*$/m,"foreach($scenario in @('success')){")
    .replace(/^ \$confirm=.*$/m," $confirm='"+lockedConfirm+"'")+'\nWrite-Output (\'AUDIT_INSTALL_ROOT \'+$root)\n';
  const filename=path.join(directory,'backup-cleanup.ps1');fs.writeFileSync(filename,'\uFEFF'+script);
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',filename],{windowsHide:true,encoding:'utf8',timeout:15000});
  if(result.error)throw result.error;assert.equal(result.status,0,result.stderr+result.stdout);
  const root=result.stdout.match(/AUDIT_INSTALL_ROOT (.+)/)[1].trim(),transactions=path.join(root,'data/updates/transactions'),id=fs.readdirSync(transactions)[0],backup=path.join(transactions,id,'backup/resources/obsolete.txt');
  assert.ok(fs.existsSync(backup),'The locked old-version backup must survive a successful update');
  await new Promise(resolve=>setTimeout(resolve,2700));
  const client=new EventEmitter();client.getOrCreateDownloadHelper=async()=>new DownloadedUpdateHelper(path.join(root,'data/updates'));
  const updates=createAutoUpdate({file:path.join(root,'data/user-data/auto-update.json'),packaged:true,currentVersion:'9.0.0',getUpdater:()=>client});
  await updates.confirmStartup();assert.equal(fs.existsSync(backup),false);
  findings.push({id:'confirmed-backup-cleanup-never-retries',passed:true,detail:'After a temporary backup lock, the next healthy startup removes the old files.',fixture:root});
}
(async()=>{
  for(const run of [manualOverwrite,interruptedCleanup,closedWindow,lostResume,backupCleanup])await run();
  fs.writeFileSync(path.join(directory,'findings.json'),JSON.stringify(findings,null,2));
  console.log(JSON.stringify({auditDirectory:directory,findings},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
