const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path'), assert = require('node:assert/strict');
const { createTrayController } = require('../tray-controller.cjs');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'tray-images-' + process.pid));
app.on('window-all-closed', () => {});
ipcMain.handle('get-hardware-acceleration', () => false);
for (const method of ['voice-stop', 'stop-sharing', 'leave-runtime']) ipcMain.handle(method, () => {});
app.whenReady().then(async () => {
  let win, tray, closing = false, quits = 0, showCalls = 0;
  try {
    tray = createTrayController({ Tray, Menu, nativeImage }, { getWindow: () => win, canClose: () => closing, quit: () => { quits++; } });
    win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.js'), backgroundThrottling: false } }); tray.attach(win); const show = win.show.bind(win); win.show = () => { showCalls++; show(); };
    await win.loadFile(path.join(root, 'renderer/index.html'));
    const run = code => win.webContents.executeJavaScript(code, true);
    assert.equal(await run(`(async () => { const { saveCachedImage, readCachedImage } = await import('./image-cache.mjs'); const image = 'data:image/png;base64,' + 'AQID'.repeat(699050) + 'AAA='; await saveCachedImage('avatar', image); return (await readCachedImage('avatar')) === image; })()`), true);
    await win.reload(); await new Promise(r => setTimeout(r, 400));
    assert.equal(await run(`(async () => { const { state } = await import('./shared.js'); for (let i = 0; i < 50 && !state.userAvatar; i++) await new Promise(r => setTimeout(r, 20)); return state.userAvatar?.length > 2 * 1024 * 1024; })()`), true);
    tray.show(); await new Promise(r => setTimeout(r, 150)); assert.ok(showCalls > 0); win.close();
    assert.equal(win.isDestroyed(), false); assert.equal(win.isVisible(), false); assert.equal(quits, 0);
    tray.show(); await new Promise(r => setTimeout(r, 150)); assert.ok(showCalls > 0); closing = true; win.close(); await new Promise(r => setTimeout(r, 150)); assert.equal(win.isDestroyed(), true);
    console.log('TRAY_AND_LARGE_IMAGE_OK', JSON.stringify({ closeHides: true, restore: true, realClose: true, largeAvatarPersists: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { tray?.destroy(); if (win && !win.isDestroyed()) win.destroy(); app.exit(process.exitCode || 0); }
});
