const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), assert = require('assert/strict');
const { createSignalingServer } = require('../../../server/server');
const root = path.resolve(__dirname, "../..");
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'reconnect-' + process.pid));
app.on('window-all-closed', () => {});
ipcMain.handle('get-hardware-acceleration', () => false);
ipcMain.handle('start-easytier', () => '10.144.1.1');
ipcMain.handle('stop-sharing', () => {}); ipcMain.handle('leave-runtime', () => {}); ipcMain.handle('voice-stop', () => {});
app.whenReady().then(async () => {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  let window, blocked = false, connections = 0;
  io.use((_socket, next) => next(blocked ? new Error('temporarily unavailable') : undefined));
  io.on('connection', () => connections++);
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = async (condition, limit = 6500) => {
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) { if (await run(condition)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Reconnect test timeout: ' + condition);
  };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true } });
    await window.loadFile(path.join(root, 'renderer/index.html'));
    await run(`localStorage.setItem('voiceMuted', 'true'); localStorage.setItem('voiceDeafened', 'true')`);
    await window.loadFile(path.join(root, 'renderer/index.html'));
    await run(`(async()=>{await import('./renderer.js');window.channelVoice.sync=()=>{}})()`);
    const join = async () => {
      await run(`document.querySelector('#serverUrl').value = 'http://127.0.0.1:${server.address().port}'; document.querySelector('#userName').value = 'Reconnect'; document.querySelector('#btnConnect').click()`);
      await wait(`document.querySelector('#room').classList.contains('active')`);
    };
    await join();
    const channel = await run(`(async () => { const { requestServer } = await import('./signaling.js'); const { switchChannel } = await import('./room.js'); const channel = (await requestServer('create-channel', { name: 'Restore' })).channel; await switchChannel(channel.id); return channel.id; })()`);
    const old = [...io.sockets.sockets.values()][0].id;
    [...io.sockets.sockets.values()][0].conn.close();
    await wait(`(async () => { const { socket } = await import('./signaling.js'); const { state } = await import('./shared.js'); return socket?.connected && socket.id !== '${old}' && state.channelId === '${channel}' && state.serverUsers.some(u => u.name === 'Reconnect' && u.role === 'host'); })()`, 5000);
    await run(`document.querySelector('#btnLeaveChannel').click()`);
    await wait(`(async()=>{const {state}=await import('./shared.js');return state.channelId===null && document.querySelector('#channelNameDisplay').textContent==='未加入频道';})()`);
    const outsideSocket=[...io.sockets.sockets.values()][0].id;
    [...io.sockets.sockets.values()][0].conn.close();
    await wait(`(async()=>{const {socket}=await import('./signaling.js'),{state}=await import('./shared.js');return socket?.connected && socket.id!=='${outsideSocket}' && state.channelId===null && document.querySelector('#btnShare').disabled;})()`,5000);
    blocked = true; const started = Date.now();
    [...io.sockets.sockets.values()][0].conn.close();
    await wait(`document.querySelector('#lobby').classList.contains('active')`);
    assert.ok(Date.now() - started < 5700, 'Entire reconnect process must respect the five-second deadline');
    blocked = false; await join();
    const before = connections; const kicked = [...io.sockets.sockets.values()][0];
    kicked.emit('kicked'); kicked.disconnect(true);
    await wait(`document.querySelector('#lobby').classList.contains('active')`);
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(connections, before); assert.equal(io.sockets.sockets.size, 0);
    await join(); const active = connections;
    await run(`document.querySelector('#btnLeave').click()`);
    await wait(`document.querySelector('#lobby').classList.contains('active')`);
    await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(connections, active);
    console.log('RECONNECT_OK', JSON.stringify({ transportRecovery: true, channelAndOwnerRestored: true, fiveSecondDeadline: true, noReconnectAfterKick: true, noReconnectAfterLeave: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { window?.destroy(); await new Promise(resolve => io.close(resolve)); app.exit(process.exitCode || 0); }
});
