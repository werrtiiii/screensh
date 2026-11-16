const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');

function createEasyTierFirewall({ installRoot, backupDirectory, platform = process.platform, execute = execFile, warn = message => console.warn('[EasyTier firewall]', message) }) {
  // A stable name prevents eight new interface rules on every reconnect.
  // Distinct installations remain isolated from each other and EasyTier GUI.
  const interfaceName = 'ScreenSh-' + createHash('sha256').update(path.resolve(installRoot).toLowerCase()).digest('hex').slice(0, 16);
  let running;
  function cleanup() {
    if (platform !== 'win32') return Promise.resolve();
    if (running) return running;
    running = (async () => {
      const script = fs.readFileSync(path.join(__dirname, 'easytier-firewall.ps1'), 'utf8');
      const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
      // Read from asar in Electron and execute the fixed script without a shell.
      const command = `& {\n${script}\n} -Apply -InterfaceName ${quote(interfaceName)} -BackupDirectory ${quote(backupDirectory)}`;
      const encoded = Buffer.from(command, 'utf16le').toString('base64');
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      return await new Promise((resolve, reject) => execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 }, (error, stdout) => {
        if (error) return reject(error);
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch { reject(Error('Invalid firewall cleanup result')); }
      }));
    })().catch(error => { warn(error.message); }).finally(() => { running = null; });
    return running;
  }
  return { interfaceName, cleanup };
}
module.exports = { createEasyTierFirewall };
