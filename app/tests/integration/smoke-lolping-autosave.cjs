const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LolPingRuntime } = require('../../lolping/runtime.cjs');
const root = path.resolve(__dirname, '../..');
const id = '00000000-0000-0000-0000-000000000000';
app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, '.runtime-probe', `lolping-autosave-${process.pid}`));
app.on('window-all-closed', () => {});
const wait = async predicate => {
  for (let n = 0; n < 150; n++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error('lolPing autosave timeout');
};
app.whenReady().then(async () => {
  const runtime = new LolPingRuntime({ file: path.join(app.getPath('userData'), 'config.json'), helper: '', send() {} });
  let releaseSave, failNext = false, writes = 0, active = 0, maxActive = 0;
  ipcMain.handle('get-hardware-acceleration', () => false);
  ipcMain.handle('get-login-startup', () => false);
  ipcMain.handle('get-tunnel-mode', () => 'tun');
  ipcMain.handle('set-voice-timing', () => null);
  ipcMain.handle('get-update-acceleration', () => ({ enabled: false, sources: [] }));
  ipcMain.handle('get-update-settings', () => ({ enabled: false, status: 'current' }));
  ipcMain.handle('confirm-startup', () => null);
  ipcMain.handle('stop-sharing', () => null);
  ipcMain.handle('leave-runtime', () => runtime.stop());
  ipcMain.handle('lolping-get', () => runtime.get(id));
  ipcMain.handle('lolping-sync', () => null);
  ipcMain.handle('lolping-input-suspend', () => {});
  ipcMain.handle('lolping-save', async (_event, configId, patch) => {
    active++; maxActive = Math.max(active, maxActive); writes++;
    try {
      if (releaseSave) await new Promise(resolve => { releaseSave = resolve; });
      if (failNext) { failNext = false; throw Error('测试保存失败'); }
      return await runtime.save(configId, patch);
    } finally { active--; }
  });
  try {
    const win = new BrowserWindow({ width: 960, height: 640, show: false, webPreferences: { preload: path.join(root, 'preload.js') } });
    const run = code => win.webContents.executeJavaScript(code, true);
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await run(`document.querySelector('#btnSettings').click();document.querySelector('#btnLolPingConfig').click()`);
    await wait(() => run(`!document.querySelector('#lolPingDialog').classList.contains('hidden')`));
    const edit = value => run(`(()=>{const input=document.querySelector('[name="volume"]');input.value=${value};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const hidden = () => run(`document.querySelector('#lolPingDialog').classList.contains('hidden')`);
    const close = () => run(`document.querySelector('#lolPingDialog').click()`);
    const open = async () => {
      await run(`document.querySelector('#btnLolPingConfig').click()`);
      await wait(async () => !await hidden());
    };
    await edit(31);
    await wait(() => runtime.get(id).config.volume === 31);
    assert.equal(await hidden(), false, 'autosaving keeps the editor open');
    assert.equal(await run(`!!document.querySelector('#btnSaveLolPing')`), false);
    await run(`document.querySelector('#lolPingFields').click()`);
    assert.equal(await hidden(), false, 'inside clicks do not dismiss the editor');
    await run(`(()=>{const input=document.querySelector('[name="muted"]');input.click();})()`);
    await wait(() => runtime.get(id).config.muted === true);
    await run(`(()=>{const details=document.querySelector('details[data-setting="wheel"]');details.open=true;const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify({key:'wheel',id:'bait'}));details.querySelector('.lolping-wheel-layout button').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}));})()`);
    await wait(() => runtime.get(id).config.wheel[0] === 'bait');
    await run(`[...document.querySelectorAll('details[data-setting="wheel"] button')].find(button=>button.textContent==='恢复默认布局').click()`);
    await wait(() => runtime.get(id).config.wheel[0] === 'danger');
    await run(`document.querySelector('[data-setting="toggleHotkey"] button').click()`);
    await wait(() => run(`document.querySelector('[data-setting="toggleHotkey"] button').textContent.includes('按下按键')`));
    await run(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ',key:'j',ctrlKey:true,bubbles:true}))`);
    await wait(() => runtime.get(id).config.toggleHotkey.vk === 0x4a);
    await edit(32); await close(); await wait(hidden);
    assert.equal(runtime.get(id).config.volume, 32, 'close flushes the debounce');
    await open();
    assert.equal(await run(`document.querySelector('[name="volume"]').value`), '32');
    releaseSave = true;
    await edit(40); await wait(() => typeof releaseSave === 'function');
    await edit(41); await close();
    assert.equal(await hidden(), false, 'close waits for pending writes');
    const release = releaseSave; releaseSave = null; release();
    await wait(hidden);
    assert.equal(runtime.get(id).config.volume, 41);
    assert.equal(maxActive, 1, 'writes are serialized');
    await open();
    failNext = true; await edit(42);
    await run(`import('./room.js').then(module=>module.leaveRoom())`);
    await wait(() => run(`document.querySelector('#lolPingError').textContent.includes('测试保存失败')`));
    assert.equal(await hidden(), false);
    assert.equal(runtime.get(id).config.volume, 41);
    await close(); await wait(hidden);
    assert.equal(runtime.get(id).config.volume, 42, 'close retries the retained draft');
    await open();
    await run(`(()=>{const input=document.querySelector('[name="emoteTrigger"]');input.value=document.querySelector('[name="trigger"]').value;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await close();
    await wait(() => run(`document.querySelector('#lolPingError').textContent.includes('相同触发键')`));
    assert.equal(await hidden(), false, 'validation retains the editor');
    await run(`(()=>{const input=document.querySelector('[name="emoteTrigger"]');input.value='off';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await close(); await wait(hidden);
    assert.equal(runtime.get(id).config.emoteTrigger, 'off');
    await open(); await edit(43);
    await run(`document.querySelector('#lolPingDialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await wait(hidden);
    assert.equal(runtime.get(id).config.volume, 43, 'Escape also flushes the final draft');
    assert.ok(writes > 0);
    console.log('LOLPING_AUTOSAVE_OK'); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
