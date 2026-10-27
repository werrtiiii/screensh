const { test } = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createAutoUpdate} = require('../main/auto-update.cjs');
test('update check honors updater availability including old and equal releases', async () => {
  for (const [version, available] of [['1.4.3', false], ['1.4.4', false], ['1.4.5', true], ['1.4.5', false]]) {
    const updater = new EventEmitter();updater.checkForUpdates = async () => ({isUpdateAvailable:available, updateInfo:{version}});
    const updates = createAutoUpdate({file:__filename+'.missing', packaged:true, currentVersion:'1.4.4', getUpdater:() => updater});
    assert.equal((await updates.check()).available, available);
  }
});
