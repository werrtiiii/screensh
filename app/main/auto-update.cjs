const fs = require('node:fs');
const path = require('node:path');
const {CancellationToken,CancellationError}=require('builder-util-runtime');
const {updateKey,parseUpdateKey}=require('./update-identity.cjs');
const cancelled=token=>{if(token?.cancelled)throw new CancellationError();};

function createAutoUpdate({file, packaged, currentVersion, currentBuild, getUpdater, send = () => {}, downloadSource, pendingUpdates = require('./pending-update.cjs').createPendingUpdate({file:file+'.pending'})}) {
  const installed = packaged ? updateKey({version:currentVersion,build:currentBuild}) : currentVersion;
  let enabled = true;
  try { enabled = JSON.parse(fs.readFileSync(file, 'utf8')).enabled !== false; } catch {}
  let client, checking, downloading, cleaning, preparing, preparationToken, downloadToken, ready = false;
  let state = {status:'idle', currentVersion,...(currentBuild!==undefined?{currentBuild}:{})};
  let target;
  function showTarget(key) {
    const identity = parseUpdateKey(key);
    return {version:identity?.version||null,...(currentBuild!==undefined?{build:identity?.build||null}:{})};
  }
  function installLog(event){try{const log=path.join(path.dirname(file),'../logs/update-install.log');fs.mkdirSync(path.dirname(log),{recursive:true});fs.appendFileSync(log,JSON.stringify({time:new Date().toISOString(),currentVersion,...event})+'\n');}catch{}}
  const publish = value => { state = {...state, ...value}; send({enabled, ...state}); };
  function updater() {
    if (client) return client;
    client = getUpdater();
    if(currentBuild!==undefined)client.currentBuild=currentBuild;
    client.autoDownload = false;
    client.autoInstallOnAppQuit = false;
    client.disableDifferentialDownload = false;
    client.disableWebInstaller = true;
    downloadSource?.configure(client);
    // Download now; only a later startup or an explicit install can install it.
    client.on('error', error => {console.error('[Updater]', error.message);if(client.quitAndInstallCalled)installLog({stage:'launch-error',code:String(error.code||'unknown')});});
    client.on('download-progress', progress => {
      if(client.updateCancellationToken?.cancelled)return;
      const total=Number.isFinite(progress.total)&&progress.total>0?progress.total:0;
      const transferred=Number.isFinite(progress.transferred)&&progress.transferred>=0?progress.transferred:0;
      publish({status:'downloading',percent:progress.percent,total,transferred,
        downloadMode:progress.downloadMode || (total&&state.packageBytes?(total<state.packageBytes?'differential':'full'):null)});
    });
    client.on('update-downloaded', info => { if(client.updateCancellationToken?.cancelled)return; pendingUpdates.remember(client,info); target=updateKey(info); ready = true; publish({status:'ready', ...showTarget(target)}); });
    return client;
  }
  function check(token=new CancellationToken()) {
    if(cleaning)return cleaning.then(()=>check(token));
    if (!packaged) return Promise.resolve({available:false, currentVersion, development:true});
    if (checking) return checking;
    if (downloading) return Promise.resolve({available:true, currentVersion, ...showTarget(target)});
    publish({status:'checking',installFailed:false,message:null});
    checking = (async () => {
      try {
        const updaterClient=updater();updaterClient.updateCancellationToken=token;cancelled(token);
        const result = await updaterClient.checkForUpdates();cancelled(token);
        const next=result?.updateInfo?.version ? updateKey(result.updateInfo) : null;
        const info = {available:result?.isUpdateAvailable === true, currentVersion, ...showTarget(next)};
        const installer=(client.usePortableUpdates && result?.updateInfo?.portable) || result?.updateInfo?.files?.find(file=>/\.exe(?:$|[?#])/i.test(file.url||''));
        if(!info.available||target!==next)ready=false;
        target=next;
        publish({status:info.available?(ready?'ready':'available'):'current', ...showTarget(target),packageBytes:Number(installer?.size)||0});
        return info;
      } catch (error) {
        if(token.cancelled||error instanceof CancellationError)throw new CancellationError();
        const message = /404|No published versions|latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(error?.message || '')
          ? '暂无可用更新，请稍后重试' : '检查更新失败，请检查网络';
        publish({status:'error', message}); throw Error(message);
      }
    })().finally(() => { checking = null; });
    return checking;
  }
  function download(token=new CancellationToken()) {
    if(cleaning)return cleaning.then(()=>download(token));
    if (!packaged) return Promise.reject(Error('开发模式不能安装更新'));
    if (ready) return Promise.resolve(true);
    if (downloading) return downloading;
    downloading = (async () => {
      try { publish({status:'downloading', percent:0,total:0,transferred:0,downloadMode:null}); const client=updater();client.updateCancellationToken=downloadToken=token;cancelled(token);await (downloadSource?downloadSource.download(client,token):client.downloadUpdate(token));cancelled(token); return true; }
      catch(error) { if(token.cancelled||error instanceof CancellationError)throw new CancellationError();const message = '下载失败，请检查网络'; publish({status:'error', message}); throw Error(message); }
    })().finally(() => { downloading = null;downloadToken=null; });
    return downloading;
  }
  function cancel(){
    preparationToken?.cancel();downloadToken?.cancel();client?.updateCancellationToken?.cancel();
    publish({status:'idle',message:null,installFailed:false});
    return Promise.allSettled([checking,downloading,preparing].filter(Boolean));
  }
  function prepareUpdate({automatic=false,retry=false}={}){
    if(preparing)return preparing;
    const token=preparationToken=new CancellationToken();
    preparing=(async()=>{
      if(automatic&&!enabled)return {enter:true};
      const info=await check(token);cancelled(token);if(!info.available)return {enter:true};
      const restored=await pendingUpdates.restore(updater(),installed);cancelled(token);
      ready=restored?.version===target;
      if(ready&&!retry&&pendingUpdates.wasInstallAttempted?.(updater())){publish({status:'error',installFailed:true});throw Error('上次安装未完成');}
      if(!ready)await download(token);cancelled(token);
      publish({status:'ready',...showTarget(target),installFailed:false});return {install:true};
    })().finally(()=>{preparing=null;preparationToken=null;});
    return preparing;
  }
  const stop=cancel;
  function beginInstall(){const client=updater();pendingUpdates.markInstallAttempt(client,installed);installLog({stage:'handoff',version:target});return {installer:client.installerPath,sha512:client.downloadedUpdateHelper.downloadedFileInfo.sha512,version:target};}
  return {
    get: () => ({enabled, ...state}), check, download, prepareUpdate, cancel,
    beginInstall,
    async prepareInstallerFallback(version){
      if(target!==version)throw Error('更新版本已变化，已取消备用安装');
      if(parseUpdateKey(version)?.build>1)throw Error('此热修仅提供免安装更新，请重试');
      const client=updater();
      if(!/\.exe$/i.test(client.installerPath||'')){
        if(!/\.(zip|json)$/i.test(client.installerPath||''))throw Error('没有可用的更新包');
        ready=false;client.forceFullInstaller=true;
        installLog({stage:'fallback-download',version});
        try{await download();}finally{client.forceFullInstaller=false;}
      }
      if(target!==version||!client.installerPath?.endsWith(`ScreenSh-${version}-Setup.exe`))throw Error('未获取到匹配版本的完整安装包');
      installLog({stage:'fallback-handoff',version});publish({status:'installing',version,message:'正在启动备用安装程序…'});
      return beginInstall();
    },
    reportFailure(error){publish({status:'error',message:error.message});},
    install(isSilent,isForceRunAfter){
      try{
        const client=updater();pendingUpdates.markInstallAttempt(client,installed);installLog({stage:'launch',version:target,silent:isSilent});
        client.quitAndInstall(isSilent,isForceRunAfter);
        if(!client.quitAndInstallCalled)throw Error('无法启动更新安装器，请手动覆盖安装');
        return true;
      }catch(error){installLog({stage:'launch-rejected',code:String(error.code||'unknown')});publish({status:'error',installFailed:true,message:'无法启动安装，请重试或手动安装。'});return false;}
    },
    set(value) {
      if (typeof value !== 'boolean') throw Error('无效的自动更新设置');
      fs.mkdirSync(path.dirname(file), {recursive:true});
      fs.writeFileSync(file + '.tmp', JSON.stringify({enabled:value}), {mode:0o600});
      fs.renameSync(file + '.tmp', file); enabled = value;
      publish({});
      return enabled;
    },
    start() {},
    stop,
    confirmStartup(){
      if(cleaning)return cleaning;
      if(!packaged||checking||downloading||ready)return null;
      cleaning=Promise.resolve().then(()=>require('./portable-confirm.cjs').confirmPortableStartup(path.resolve(path.dirname(file),'../..'),installed)).then(async confirming=>{const root=path.resolve(path.dirname(file),'../..'),cleanup=require('./update-cleanup.cjs');await cleanup.cleanupTransactions(root,installed,confirming);await cleanup.cleanupFallbackStages(root,installed);return pendingUpdates.confirmInstalled?.(updater(),installed);}).catch(error=>{console.warn('[Updater cleanup]',error.message);return null;}).finally(()=>{cleaning=null;});return cleaning;
    },
    async restoreAtStartup() {
      if (!packaged || !enabled) return false;
      try {
        const info = await pendingUpdates.restore(updater(),installed);
        if (!info) return false;
        target=info.version;
        if(pendingUpdates.wasInstallAttempted?.(updater())){
          ready=true;installLog({stage:'previous-install-incomplete',version:info.version});
          publish({status:'error',...showTarget(target),installFailed:true,message:'上次自动更新未完成，已恢复打开当前版本。请在系统设置中重试更新，或下载安装包覆盖安装。'});return false;
        }
        ready = true; publish({status:'ready',...showTarget(target)});return true;
      } catch(error) { publish({status:'error',message:error.message});return false; }
    },
  };
}
module.exports = {createAutoUpdate};
