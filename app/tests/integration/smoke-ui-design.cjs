// Exercise real settings scrolling and motion preferences at the minimum window size.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, '.runtime-probe', 'ui-design-' + process.pid));
app.on('window-all-closed', () => {});
for (const [event, value] of [['get-hardware-acceleration', false], ['get-login-startup', false], ['lolping-get', { config: { enabled: false } }], ['lolping-sync', null]]) ipcMain.handle(event, () => value);
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, frame: false, width: 960, height: 640, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { for (let i = 0; i < 80; i++) { if (await run(code)) return; await new Promise(r => setTimeout(r, 30)); } throw Error('Timeout: ' + code); };
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await run(`(async()=>{await import('./renderer.js');window.channelVoice.sync=()=>{};document.querySelector('#userName').value='ab ababa';})()`);
    // Let entry animation finish before measuring or capturing.
    await new Promise(r => setTimeout(r, 300));
    win.showInactive();
    const shot = async name => { await new Promise(r => setTimeout(r, 260)); fs.writeFileSync(path.join(root, '.runtime-probe', name + '.png'), (await win.webContents.capturePage()).toPNG()); };
    await shot('ui-lobby-light');
    await run(`document.querySelector('#btnSettings').click()`);
    await wait(`document.querySelectorAll('.settings-navigation button').length===5`);
    assert.deepEqual(await run(`[...document.querySelectorAll('.settings-navigation button')].map(n=>n.textContent)`), ['常规', '音效', 'lolPing', '聊天', '语音']);
    await shot('ui-settings-light');
    await run(`document.querySelector('.settings-navigation button:last-child').click()`);
    await wait(`(()=>{const b=document.querySelector('#settingsModal .modal-body'),n=document.querySelector('.setting-voice').getBoundingClientRect();return b.scrollTop>0 && n.top>=b.getBoundingClientRect().top-2 && n.top<b.getBoundingClientRect().bottom})()`);
    await wait(`document.querySelector('.settings-navigation [aria-current]').textContent==='语音'`);
    assert.equal(await run(`document.querySelector('.settings-navigation [aria-current]').textContent`), '语音');
    await shot('ui-voice-light');
    await run(`document.documentElement.dataset.theme='dark';document.querySelector('#btnCloseSettings').click();document.querySelector('#btnSettings').click()`);
    await wait(`document.querySelector('#settingsModal .modal-body').scrollTop===0`);
    await shot('ui-settings-dark');
    // Shared settings reuse the same controls, with their own navigation targets.
    await run(`document.querySelector('#btnCloseSettings').click();document.querySelector('#btnRoomSettingsToolbar').click()`);
    await wait(`document.querySelectorAll('.settings-navigation button').length===4`);
    await run(`document.querySelector('.settings-navigation button:last-child').click()`);
    await wait(`(()=>{const b=document.querySelector('#settingsModal .modal-body'),n=document.querySelector('#bitrateInput').getBoundingClientRect();return n.top>=b.getBoundingClientRect().top && n.bottom<=b.getBoundingClientRect().bottom})()`);
    await shot('ui-sharing-dark');
    await run(`document.querySelector('#btnCloseSettings').click();(async()=>{const {showContextMenu}=await import('./context-menu.js');showContextMenu(new MouseEvent('contextmenu',{clientX:950,clientY:630}),[{label:'服务器设置',run(){}},{label:'编辑书签',run(){}}]);})()`);
    await wait(`!!document.querySelector('.context-menu')`);
    await new Promise(r => setTimeout(r, 160));
    assert.equal(await run(`(()=>{const r=document.querySelector('.context-menu').getBoundingClientRect();return r.right<=innerWidth && r.bottom<=innerHeight && r.left>=0 && r.top>=38})()`), true);
    await run(`(async()=>{(await import('./context-menu.js')).closeContextMenu();(await import('./toast.js')).toast('设置已保存','success');})()`);
    await wait(`!!document.querySelector('.toast-close')`);
    await run(`document.querySelector('.toast-close').click()`);
    await wait(`!document.querySelector('.toast')`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
    await run(`document.querySelector('#btnSettings').click()`);
    assert.equal(await run(`getComputedStyle(document.querySelector('#settingsModal .modal-content')).animationName`), 'none');
    await run(`document.querySelector('.settings-navigation button:last-child').click()`);
    assert.equal(await run(`document.querySelector('#settingsModal .modal-body').scrollTop>0`), true);
    await run(`(async()=>{(await import('./toast.js')).toast('已关闭动画');document.querySelector('.toast-close').click()})()`);
    await wait(`!document.querySelector('.toast')`);
    console.log('UI_DESIGN_OK', JSON.stringify({ minimumWindow: true, lightAndDark: true, settingsNavigation: true, menuBounds: true, toastDismiss: true, reducedMotion: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
