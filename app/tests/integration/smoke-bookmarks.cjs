const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('node:path'), assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const { io: connect } = require('../../../server/node_modules/socket.io-client');
const { createSignalingServer } = require('../../../server/server');
const root = path.resolve(__dirname, "../..");
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'bookmarks-' + process.pid));
app.on('window-all-closed', () => {});
ipcMain.handle('get-hardware-acceleration', () => false);
ipcMain.handle('start-easytier', () => '10.144.9.2');
for (const event of ['stop-sharing', 'leave-runtime', 'voice-stop']) ipcMain.handle(event, () => {});
app.whenReady().then(async () => {
  let win, owner, redirect; const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  const connections = new Set();
  const trackConnection = socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); };
  server.on('connection', trackConnection);
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async condition => { for (let i=0;i<100;i++) { if(await run(condition)) return; await new Promise(r=>setTimeout(r,50)); } throw Error('Timeout: '+condition); };
  const request = (event, payload) => new Promise((resolve, reject) => owner.timeout(2000).emit(event, payload, (error, response) => error || !response?.ok ? reject(error || Error(response.message)) : resolve(response)));
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r)); const url='http://127.0.0.1:'+server.address().port;
    redirect = http.createServer((req, res) => {
      res.writeHead(307, {Location: url + req.url, 'Access-Control-Allow-Origin':'*'}); res.end();
    });
    redirect.on('upgrade', (_req, socket) => socket.destroy());
    redirect.on('connection', trackConnection);
    await new Promise(r=>redirect.listen(0,'127.0.0.1',r));
    const address='127.0.0.1:'+redirect.address().port;
    owner=connect(url,{transports:['websocket'],reconnection:false}); await new Promise(r=>owner.once('connect',r));
    await request('join-server',{userName:'Owner',virtualIp:'10.144.9.1',identity:randomBytes(32).toString('hex'),easytierPeers:['tcp://test.example:11010']});
    const icon=nativeImage.createFromBitmap(Buffer.from([80,120,240,255]),{width:1,height:1}).toDataURL();
    await request('set-server-name',{name:'自动书签服务器'}); await request('set-server-icon',{icon});
    win=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'preload.js'),backgroundThrottling:false}});
    await win.loadFile(path.join(root,'renderer/index.html'));
    await run(`localStorage.setItem('voiceMuted','true');localStorage.setItem('voiceDeafened','true')`);
    await win.reload(); await run(`(async()=>{await import('./renderer.js');window.channelVoice.sync=()=>{}})()`);
    await run(`document.querySelector('#serverUrl').value='${address}';document.querySelector('#userName').value='Member';document.querySelector('#btnConnect').click()`);
    await wait(`document.querySelector('#room').classList.contains('active') && document.querySelector('#bookmarkList .bookmark-item img')?.src === '${icon}'`);
    assert.equal(await run(`document.querySelector('#serverUrl').value`),address);
    assert.equal(await run(`JSON.parse(localStorage.getItem('lastConnectedServer')).url`),address);
    assert.deepEqual(await run(`JSON.parse(localStorage.getItem('serverBookmarks')).map(x=>({url:x.url,name:x.name,icon:x.icon}))`),[{url:address,name:'自动书签服务器',icon:'cached'}]);
    await wait(`(async()=> (await (await import('./image-cache.mjs')).readCachedImage('bookmark:${address}')) === '${icon}')()`);
    const firstState = await request('switch-channel', {channelId:'main'});
    const member = firstState.users.find(user => user.name === 'Member');
    const memberId = firstState.memberHistory.find(user => user.name === 'Member').memberId;
    await request('set-admin', {socketId:member.socketId, enabled:true});
    // Selecting another bookmark changes the input but must not redirect metadata writes.
    await run(`document.querySelector('#serverUrl').value='https://other.example'`);
    await request('set-server-name',{name:'新服务器名称'});
    await wait(`JSON.parse(localStorage.getItem('serverBookmarks'))[0].name === '新服务器名称'`);
    assert.equal(await run(`JSON.parse(localStorage.getItem('serverBookmarks'))[0].url`),address);
    await request('set-server-icon',{icon:null});
    await wait(`!document.querySelector('#bookmarkList .bookmark-item img') && JSON.parse(localStorage.getItem('serverBookmarks'))[0].icon === null`);
    await request('set-server-icon',{icon}); await wait(`document.querySelector('#bookmarkList .bookmark-item img')?.src === '${icon}'`);
    await run(`document.querySelector('#btnLeave').click()`); await wait(`document.querySelector('#lobby').classList.contains('active')`);
    await win.reload(); await run(`(async()=>{await import('./renderer.js');window.channelVoice.sync=()=>{}})()`); await wait(`document.querySelector('#bookmarkList .bookmark-item img')?.src === '${icon}'`);
    await run(`document.querySelector('#serverUrl').value='${address}';document.querySelector('#btnConnect').click()`); await wait(`document.querySelector('#room').classList.contains('active')`);
    assert.equal(await run(`JSON.parse(localStorage.getItem('serverBookmarks')).length`),1);
    await run(`document.querySelector('#btnLeave').click()`); await wait(`document.querySelector('#lobby').classList.contains('active')`);
    // A different address for the same server must retain the profile and administrator role.
    await run(`document.querySelector('#serverUrl').value='${url}';document.querySelector('#btnConnect').click()`);
    await wait(`document.querySelector('#room').classList.contains('active')`);
    const aliasState = await request('switch-channel', {channelId:'main'});
    assert.equal(aliasState.users.find(user => user.name === 'Member').role, 'admin');
    assert.deepEqual(aliasState.memberHistory.filter(user => user.name === 'Member').map(user => user.memberId), [memberId]);
    await run(`document.querySelector('#btnLeave').click()`); await wait(`document.querySelector('#lobby').classList.contains('active')`);
    await request('set-server-password',{enabled:true,password:'test-password'});
    await run(`localStorage.setItem('serverBookmarks','[]')`);
    await run(`document.querySelector('#serverUrl').value='${url}';document.querySelector('#userName').value='Owner';document.querySelector('#btnConnect').click()`);
    // Password cancellation must not create or change a bookmark.
    await wait(`!!document.querySelector('.password-modal')`);
    await run(`document.querySelector('.password-cancel').click()`);
    await wait(`document.querySelector('#lobby').classList.contains('active') && !document.querySelector('#btnConnect').disabled`);
    assert.equal(await run(`JSON.parse(localStorage.getItem('serverBookmarks')).length`),0);
    console.log('BOOKMARKS_OK',JSON.stringify({autoAdd:true,metadataSync:true,correctAddress:true,resetIcon:true,persistence:true,noDuplicates:true,redirect:true,originalInputPreserved:true,aliasIdentityAndRole:true}));
  } catch(error) { console.error(error.stack); process.exitCode=1; }
  finally {win?.destroy();owner?.disconnect();for(const connection of connections)connection.destroy();if(redirect)await new Promise(r=>redirect.close(r));await new Promise(r=>io.close(r));app.exit(process.exitCode||0);}
});
