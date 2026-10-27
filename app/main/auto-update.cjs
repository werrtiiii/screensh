const fs = require('node:fs');
const path = require('node:path');

function createAutoUpdate({file, packaged, currentVersion, getUpdater, send = () => {}, intervalMs = 6 * 60 * 60 * 1000, startupMs = 10000, pendingUpdates = require('./pending-update.cjs').createPendingUpdate({file:file+'.pending'})}) {
  let enabled = true;
  try { enabled = JSON.parse(fs.readFileSync(file, 'utf8')).enabled !== false; } catch {}
  let client, checking, downloading, timer, startup, ready = false;
  let state = {status:'idle', currentVersion};
  const publish = value => { state = {...state, ...value}; send({enabled, ...state}); };
  function updater() {
    if (client) return client;
    client = getUpdater();
    client.autoDownload = false;
    client.autoInstallOnAppQuit = false;
    // Download now; only a later startup or an explicit install can install it.
    client.on('error', error => console.error('[Updater]', error.message));
    client.on('download-progress', progress => publish({status:'downloading', percent:progress.percent}));
    client.on('update-downloaded', info => { pendingUpdates.remember(client,info); ready = true; publish({status:'ready', version:info.version}); });
    return client;
  }
  function check() {
    if (!packaged) return Promise.resolve({available:false, currentVersion, development:true});
    if (checking) return checking;
    if (downloading || ready) return Promise.resolve({available:true, currentVersion, version:state.version});
    publish({status:'checking'});
    checking = (async () => {
      try {
        const result = await updater().checkForUpdates();
        const info = {available:result?.isUpdateAvailable === true, currentVersion, version:result?.updateInfo?.version || null};
        publish({status:info.available?'available':'current', version:info.version});
        return info;
      } catch (error) {
        const message = /404|No published versions|latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(error?.message || '')
          ? 'GitHub 尚未发布可用安装包，请稍后重试' : '检查更新失败，请确认网络连接后重试';
        publish({status:'error', message}); throw Error(message);
      }
    })().finally(() => { checking = null; });
    return checking;
  }
  function download() {
    if (!packaged) return Promise.reject(Error('开发模式不能安装更新'));
    if (ready) return Promise.resolve(true);
    if (downloading) return downloading;
    downloading = (async () => {
      try { publish({status:'downloading', percent:0}); await updater().downloadUpdate(); return true; }
      catch { const message = '下载更新失败，请确认网络连接后重试'; publish({status:'error', message}); throw Error(message); }
    })().finally(() => { downloading = null; });
    return downloading;
  }
  async function automatic() {
    if (!enabled || !packaged) return;
    try { const result = await check(); if (enabled && result.available) await download(); } catch { /* Status is visible in settings; retry on the next check. */ }
  }
  function stop() { clearTimeout(startup); clearInterval(timer); startup = timer = null; }
  return {
    get: () => ({enabled, ...state}), check, download,
    set(value) {
      if (typeof value !== 'boolean') throw Error('无效的自动更新设置');
      fs.mkdirSync(path.dirname(file), {recursive:true});
      fs.writeFileSync(file + '.tmp', JSON.stringify({enabled:value}), {mode:0o600});
      fs.renameSync(file + '.tmp', file); enabled = value;
      publish({});
      if (enabled) void automatic();
      return enabled;
    },
    start() { stop(); if (!packaged) return; startup = setTimeout(automatic, startupMs); timer = setInterval(automatic, intervalMs); startup.unref?.(); timer.unref?.(); },
    stop,
    async restoreAtStartup() {
      if (!packaged || !enabled) return false;
      try {
        const info = await pendingUpdates.restore(updater(),currentVersion);
        if (!info) return false;
        ready = true; publish({status:'ready',version:info.version});return true;
      } catch(error) { publish({status:'error',message:error.message});return false; }
    },
  };
}
module.exports = {createAutoUpdate};
