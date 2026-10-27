const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), assert = require('assert/strict');
const { createSignalingServer } = require('../../../server/server');
const {io:connect}=require('socket.io-client');
const root = path.resolve(__dirname, "../..");
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'reconnect-' + process.pid));
app.on('window-all-closed', () => {});
ipcMain.handle('get-hardware-acceleration', () => false);
ipcMain.handle('get-tunnel-mode',()=> 'tun');
ipcMain.handle('set-voice-timing',()=>{});
let savedPassword='';
ipcMain.handle('get-saved-server-password',()=>savedPassword);
ipcMain.handle('save-server-password',(_event,_url,_id,password)=>{savedPassword=password;});
ipcMain.handle('lolping-get',()=>({config:{enabled:false}}));
ipcMain.handle('lolping-sync',()=>{});
ipcMain.handle('get-login-startup',()=>false);
ipcMain.handle('start-easytier', () => '10.144.1.1');
ipcMain.handle('stop-sharing', () => {}); ipcMain.handle('leave-runtime', () => {}); ipcMain.handle('voice-stop', () => {});
app.whenReady().then(async () => {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  let window, staleClient, blocked = false, connections = 0;
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
    await wait(`(async () => { const { socket } = await import('./signaling.js'); const { state } = await import('./shared.js'); return socket?.connected && socket.id !== '${old}' && state.channelId === '${channel}' && state.serverUsers.some(u => u.socketId===socket.id && u.name === 'Reconnect' && u.role === 'host'); })()`, 5000);
    await run(`document.querySelector('#btnLeaveChannel').click()`);
    await wait(`(async()=>{const {state}=await import('./shared.js');return state.channelId===null && document.querySelector('#channelNameDisplay').textContent==='';})()`);
    const outsideSocket=[...io.sockets.sockets.values()][0].id;
    [...io.sockets.sockets.values()][0].conn.close();
    await wait(`(async()=>{const {socket}=await import('./signaling.js'),{state}=await import('./shared.js');return socket?.connected && socket.id!=='${outsideSocket}' && state.serverUsers.some(u=>u.socketId===socket.id) && state.channelId===null && document.querySelector('#btnShare').disabled;})()`,5000);
    blocked = true; const started = Date.now();
    [...io.sockets.sockets.values()][0].conn.close();
    await wait(`document.querySelector('#lobby').classList.contains('active')`);
    assert.ok(Date.now() - started < 5700, 'Entire reconnect process must respect the five-second deadline');
    blocked = false;
    // A physical link outage can leave the server's old socket alive until
    // its heartbeat timeout, even after this client has returned to the lobby.
    staleClient=connect('http://127.0.0.1:'+server.address().port,{transports:['websocket'],reconnection:false});
    await new Promise((resolve,reject)=>{staleClient.once('connect',resolve);staleClient.once('connect_error',reject);});
    const staleRequest=(event,payload={})=>new Promise((resolve,reject)=>staleClient.timeout(2000).emit(event,payload,(error,response)=>error?reject(error):resolve(response)));
    const info=await staleRequest('server-info');
    const identity=await run(`localStorage.getItem('serverIdentity:${info.serverId}')`);
    assert.ok(identity,'manual reconnect must reuse the saved server identity');
    const access=await staleRequest('check-access',{userName:'Reconnect',identity});
    const staleJoin=await staleRequest('join-server',{userName:'Reconnect',identity,virtualIp:'10.144.1.1',easytierPeers:access.easytierPeers});
    assert.equal(staleJoin.ok,true);const staleId=staleClient.id;
    await join();
    assert.equal(staleClient.connected,false,'the authenticated reconnect replaces its stale session immediately');
    assert.equal(io.sockets.sockets.has(staleId),false);
    assert.equal(await run(`document.body.innerText.includes('名称已被使用')`),false);
    await run(`document.querySelector('#btnLeave').click()`);
    await wait(`document.querySelector('#lobby').classList.contains('active') && !document.querySelector('#btnConnect').disabled`);
    staleClient=connect('http://127.0.0.1:'+server.address().port,{transports:['websocket'],reconnection:false});
    await new Promise((resolve,reject)=>{staleClient.once('connect',resolve);staleClient.once('connect_error',reject);});
    assert.equal((await staleRequest('join-server',{userName:'Reconnect',identity,virtualIp:'10.144.1.1',easytierPeers:access.easytierPeers})).ok,true);
    savedPassword='reconnect-test-secret';
    assert.equal((await staleRequest('set-server-password',{enabled:true,password:savedPassword})).ok,true);
    const wrongIdentity=await staleRequest('check-access',{userName:'Reconnect',identity:'f'.repeat(64),password:savedPassword});
    assert.equal(wrongIdentity.ok,false,'another identity must still be refused the occupied name');
    await join();assert.equal(staleClient.connected,false,'cached-password preflight also reclaims the authenticated stale session');
    const before = connections; const kicked = [...io.sockets.sockets.values()][0];
    kicked.emit('kicked'); kicked.disconnect(true);
    await wait(`document.querySelector('#lobby').classList.contains('active')`);
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(connections, before); assert.equal(io.sockets.sockets.size, 0);
    await join(); const active = connections;
    await run(`document.querySelector('#btnLeave').click()`);
    await wait(`document.querySelector('#lobby').classList.contains('active')`);
    await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(connections, active);
    console.log('RECONNECT_OK', JSON.stringify({ transportRecovery: true, channelAndOwnerRestored: true, staleSessionReclaimed:true,cachedPassword:true,otherIdentityRejected:true, fiveSecondDeadline: true, noReconnectAfterKick: true, noReconnectAfterLeave: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { staleClient?.disconnect();window?.destroy(); await new Promise(resolve => io.close(resolve)); app.exit(process.exitCode || 0); }
});
