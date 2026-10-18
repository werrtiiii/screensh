const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'), assert = require('node:assert/strict');
const { createSignalingServer } = require('../../../server/server');
const { io: connect } = require('../../../server/node_modules/socket.io-client');
const root = path.resolve(__dirname, '../..');
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'app-presence-' + process.pid));
app.on('window-all-closed', () => {});
for (const [event, value] of [['get-hardware-acceleration', false], ['get-login-startup', false], ['lolping-get', { config: { enabled: false } }], ['lolping-sync', null], ['leave-runtime', null], ['stop-sharing', null], ['save-server-password', true], ['get-saved-server-password', null], ['start-easytier', '10.144.90.2']]) ipcMain.handle(event, () => value);
const request = (socket, event, payload = {}) => new Promise((resolve, reject) => socket.timeout(2000).emit(event, payload, (error, answer) => error ? reject(error) : resolve(answer)));
app.whenReady().then(async () => {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010', disconnectGraceMs: 50, presenceSweepMs: 20 });
  let win, host;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    host = connect(url, { transports: ['websocket'], reconnection: false });
    await new Promise(resolve => host.once('connect', resolve));
    await request(host, 'join-server', { userName: 'Observer', identity: 'a'.repeat(64), virtualIp: '10.144.90.1', easytierPeers: ['tcp://test.example:11010'] });
    win = new BrowserWindow({ show: false, frame: false, webPreferences: { preload: path.join(root, 'preload.js'), backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    const wait = async check => { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error('Presence condition timed out'); };
    const state = () => request(host, 'switch-channel', { channelId: 'main' });
    const visitor = snapshot => snapshot.memberHistory.find(user => user.name === 'Visitor');
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await run(`(async()=>{await import('./renderer.js');localStorage.setItem('autoConnectLastServer','false');window.channelVoice.sync=()=>{};document.querySelector('#userName').value='Visitor';document.querySelector('#serverUrl').value='${url}';document.querySelector('#btnConnect').click()})()`);
    await wait(async () => (await state()).users.length === 2);
    await wait(async () => io.sockets.sockets.size === 3); // Viewer, server membership, and background status.
    await run(`document.querySelector('#btnLeave').click()`);
    await wait(async () => { const snapshot = await state(); return snapshot.users.length === 1 && visitor(snapshot)?.online && !visitor(snapshot).inServer; });
    assert.equal(await run(`document.querySelector('#lobby').classList.contains('active')`), true);
    win.hide();
    assert.equal(visitor(await state()).online, true, 'hidden/tray window stays online without membership');
    await run(`(async()=>{(await import('./toast.js')).toast('测试');})()`); // Window remains alive while hidden.
    win.close(); win = null;
    await wait(async () => !visitor(await state()).online);
    // Restart at the home page: persisted bookmark and identity restore status without auto-joining.
    win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.js'), backgroundThrottling: false } });
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await wait(async () => visitor(await state()).online);
    assert.equal((await state()).users.length, 1, 'home-page presence does not join the server');
    console.log('APP_PRESENCE_UI_OK', JSON.stringify({ leaveServerStaysOnline: true, hiddenStaysOnline: true, closeGoesOffline: true, restartHomeOnline: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { win?.destroy(); host?.disconnect(); await new Promise(resolve => io.close(resolve)); app.exit(process.exitCode || 0); }
});
