const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('update check honors updater availability including old and equal releases', async () => {
  const source = fs.readFileSync(path.join(__dirname, "../main.js"), 'utf8');
  const begin = source.indexOf("ipcMain.handle('check-for-update'");
  const end = source.indexOf("ipcMain.handle('download-and-install-update'", begin);
  for (const [version, available] of [['1.4.3', false], ['1.4.4', false], ['1.4.5', true], ['1.4.5', false]]) {
    let handler;
    vm.runInNewContext(source.slice(begin, end), {
      ipcMain: { handle: (_event, fn) => { handler = fn; } },
      app: { isPackaged: true, getVersion: () => '1.4.4' },
      getUpdater: () => ({ checkForUpdates: async () => ({ isUpdateAvailable: available, updateInfo: { version } }) }), console,
    });
    assert.equal((await handler()).available, available);
  }
});
