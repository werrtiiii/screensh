const { execFile } = require('node:child_process');
const { windowsHelper } = require('./windows-helper.cjs');

function repairFrame(handle, rounded) {
  return new Promise((resolve, reject) => execFile(windowsHelper(), ['window-frame', handle, String(process.pid), String(rounded)],
    { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    }));
}

function attachWindowMaterial(win, { nativeGlass, repair = repairFrame, delay = 100 } = {}) {
  let timer, disposed = false, chain = Promise.resolve();
  const contents = win.webContents;
  const state = () => ({ maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  function publish() {
    if (!disposed && !win.isDestroyed()) win.webContents.send('window-state', state());
  }
  function refresh() {
    clearTimeout(timer);
    chain = chain.then(async () => {
      if (disposed || win.isDestroyed()) return;
      publish();
      if (!nativeGlass) return;
      const handle = win.getNativeWindowHandle();
      const id = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
      const current = state();
      return await repair(String(id), !current.maximized && !current.fullscreen);
    }).catch(error => console.warn('[Window material]', error.message));
    return chain;
  }
  function changed() { publish(); clearTimeout(timer); timer = setTimeout(refresh, delay); }
  const events = ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen'];
  for (const event of events) win.on(event, changed);
  contents.on('did-finish-load', changed);
  function dispose() {
    disposed = true; clearTimeout(timer);
    for (const event of events) win.removeListener(event, changed);
    contents.removeListener('did-finish-load', changed);
    return chain;
  }
  win.once('closed', dispose);
  return { refresh, dispose };
}
module.exports = { attachWindowMaterial };
