const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const {windowsHelper}=require('./windows-helper.cjs');

function createEasyTierFirewall({ installRoot, backupDirectory, platform = process.platform, execute = execFile, warn = message => console.warn('[EasyTier firewall]', message) }) {
  // A stable name prevents eight new interface rules on every reconnect.
  // Distinct installations remain isolated from each other and EasyTier GUI.
  const interfaceName = 'ScreenSh-' + createHash('sha256').update(path.resolve(installRoot).toLowerCase()).digest('hex').slice(0, 16);
  let running;
  function cleanup() {
    if (platform !== 'win32') return Promise.resolve();
    if (running) return running;
    running = (async () => {
      return await new Promise((resolve, reject) => execute(windowsHelper(), ['firewall',interfaceName,backupDirectory,'apply'], { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 }, (error, stdout) => {
        if (error) return reject(error);
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch { reject(Error('Invalid firewall cleanup result')); }
      }));
    })().catch(error => { warn(error.message); }).finally(() => { running = null; });
    return running;
  }
  return { interfaceName, cleanup };
}
module.exports = { createEasyTierFirewall };
