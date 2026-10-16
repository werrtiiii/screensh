// Two real renderer instances, direct microphone capture and real WebRTC.
// EasyTier startup is mocked; this does not claim cross-computer routing coverage.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), os = require('os'), assert = require('assert/strict');
const { createSignalingServer } = require('../../server/server');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, '.runtime-probe', `voice-ui-${process.pid}`));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map(i => i.address);
  const windows = [], addresses = new Map();
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  let nativeVoiceCalls = 0;
  for (const name of ['voice-start', 'voice-stop', 'voice-devices']) ipcMain.handle(name, () => { nativeVoiceCalls++; throw Error('Direct capture must not use OBS voice IPC'); });
  ipcMain.handle('get-hardware-acceleration', () => false);
  ipcMain.handle('ping-member', (_event, ip) => ({ ip, rttMs: 1 }));
  ipcMain.handle('start-easytier', event => addresses.get(event.sender.id));
  ipcMain.handle('leave-runtime', () => {}); ipcMain.handle('stop-sharing', () => {});
  const run = (w, code) => w.webContents.executeJavaScript(code, true);
  const wait = async (w, condition) => {
    for (let i = 0; i < 150; i++) { if (await run(w, condition)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('Voice UI timeout: ' + condition + '\n' + await run(w, `document.body.innerText.slice(-1200)`));
  };
  try {
    if (!ips.length) throw new Error('本机需可用的 IPv4 接口');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (let i = 0; i < 2; i++) {
      const win = new BrowserWindow({ show: false, webPreferences: { partition: 'voice-ui-' + process.pid + '-' + i, preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
      windows.push(win); addresses.set(win.webContents.id, '10.144.1.' + (i + 1));
      await win.loadFile(path.join(root, 'renderer/index.html'));
      await run(win, `(async () => { await import('./renderer.js'); window.toneContext = new AudioContext(); await toneContext.resume(); const osc = toneContext.createOscillator(), gain = toneContext.createGain(), out = toneContext.createMediaStreamDestination(); gain.gain.value = 0.03; osc.connect(gain).connect(out); osc.start(); window.capturedMicrophones=[]; window.captureConstraints=[]; navigator.mediaDevices.getUserMedia=async constraints=>{captureConstraints.push(constraints);const stream=out.stream.clone();capturedMicrophones.push(stream);return stream;};navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audiooutput',deviceId:'default',label:'Test output'},{kind:'audioinput',deviceId:'default',label:'Test signal'},{kind:'audioinput',deviceId:'alternate',label:'Alternate signal'}];window.voicePCs = []; const PC = RTCPeerConnection; window.RTCPeerConnection = class extends PC { constructor(...args) { super(...args); voicePCs.push(this); }
        get localDescription() { const d = super.localDescription; return d && { type: d.type, sdp: d.sdp.split('${ips[0]}').join('10.144.1.${i+1}') }; }
        set onicecandidate(fn) { super.onicecandidate = fn && (e => { if (!e.candidate) return fn(e); const c = e.candidate.toJSON(); c.candidate = c.candidate.split('${ips[0]}').join('10.144.1.${i+1}'); fn({candidate:{...c,toJSON:()=>c}}); }); }
        async setRemoteDescription(d) { return super.setRemoteDescription({type:d.type,sdp:d.sdp.replace(/10\\.144\\.1\\.[12]/g,'${ips[0]}')}); }
        async addIceCandidate(c) { return super.addIceCandidate({...c,candidate:c.candidate.replace(/10\\.144\\.1\\.[12]/g,'${ips[0]}')}); } }; document.querySelector('#serverUrl').value = 'http://127.0.0.1:${server.address().port}'; document.querySelector('#userName').value = 'Voice ${i}'; document.querySelector('#btnConnect').click(); })()`);
      await wait(win, `document.querySelector('#room').classList.contains('active')`);
      await wait(win, `(async () => { const { state } = await import('./shared.js'); return state.serverUsers.some(u => u.name === 'Voice ${i}' && u.voiceEnabled) && !document.querySelector('[data-voice="mute"]').disabled; })()`);
    }
    for (const win of windows) {
      await wait(win, `voicePCs.filter(pc => pc.connectionState === 'connected').length === 1`);
      await wait(win, `(async()=>{for(const pc of voicePCs.filter(p=>p.connectionState==='connected')){const stats=await pc.getStats();if([...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.packetsReceived>0))return true;}return false;})()`);
      const stats = await run(win, `(async () => { const result = []; for (const pc of voicePCs) { const stats = await pc.getStats(); for (const s of stats.values()) if (s.type === 'inbound-rtp' && s.kind === 'audio') result.push(s.packetsReceived); } return result; })()`);
      assert.equal(stats.length, 1); assert.ok(stats.every(count => count > 0));
    }
    const [host, guest] = windows;
    for (const win of windows) assert.equal(await run(win, `(async () => document.querySelector('.user-card').dataset.userId === (await import('./signaling.js')).socket.id)()`), true);
    const guestId = await run(guest, `(async () => (await import('./signaling.js')).socket.id)()`);
    await run(host, `document.querySelector('#btnServerSettings').click(); document.querySelector('#serverNameInput').value='语音测试服务器';document.querySelector('#serverNameForm').requestSubmit()`);
    await wait(guest, `document.querySelector('#roomServerName').textContent === '语音测试服务器'`);
    host.show(); await new Promise(r => setTimeout(r, 200));
    require('node:fs').writeFileSync(path.join(root, '.runtime-probe', 'server-name-settings.png'), (await host.webContents.capturePage()).toPNG());
    await run(host, `document.querySelector('#btnCloseServerSettings').click()`);
    await run(host, `document.querySelector('.receive-volume-control button').focus()`);
    assert.equal(await run(host, `getComputedStyle(document.querySelector('.receive-volume-control .speaker-popover')).display !== 'none'`), true);
    await new Promise(r => setTimeout(r, 100));
    require('node:fs').writeFileSync(path.join(root, '.runtime-probe', 'receive-volume-control.png'), (await host.webContents.capturePage()).toPNG());
    await run(guest, `document.querySelector('[data-voice="deafen"]').click()`);
    await wait(host, `!!document.querySelector('[data-user-id="${guestId}"] .remote-headphones-off')`);
    await run(guest, `document.querySelector('[data-voice="deafen"]').click()`);
    await wait(host, `!document.querySelector('[data-user-id="${guestId}"] .remote-headphones-off')`);
    await run(guest, `const receive = document.querySelector('.receive-volume-control input'); receive.value=0;receive.dispatchEvent(new Event('input'))`);
    assert.equal(await run(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a=>a.volume===0)`), true);
    assert.equal(await run(host, `!!document.querySelector('[data-user-id="${guestId}"] .remote-headphones-off')`), false);
    await run(guest, `document.querySelector('.receive-volume-control input').value=100;document.querySelector('.receive-volume-control input').dispatchEvent(new Event('input'))`);
    const beforeRetry = await run(host, 'voicePCs.length');
    await run(host, `{ const pc = voicePCs.find(pc => pc.connectionState === 'connected'); Object.defineProperty(pc, 'connectionState', { configurable: true, value: 'failed' }); pc.onconnectionstatechange(); delete pc.connectionState; }`);
    await wait(host, `voicePCs.length > ${beforeRetry} && voicePCs.filter(pc => pc.connectionState === 'connected').length === 1`);

    await run(guest, `document.querySelector('[data-voice="mute"]').click(); const volume = document.querySelector('.remote-user-card .voice-volume input'); volume.value = 50; volume.dispatchEvent(new Event('input')); const total=document.querySelector('.receive-volume-control input');total.value=50;total.dispatchEvent(new Event('input'));`);
    assert.equal(await run(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => !a.muted && a.volume === 0.25)`), true);
    await run(guest, `document.querySelector('.remote-speaker-button').click()`);
    assert.equal(await run(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => a.muted && a.volume === 0.25) && document.querySelector('.remote-speaker-button').getAttribute('aria-pressed') === 'true'`), true);
    assert.equal(await run(guest, `voicePCs.filter(pc=>pc.connectionState==='connected').length`), 1, 'blocking keeps voice connection alive');
    await run(guest, `document.querySelector('.remote-user-card .voice-volume input').value=40;document.querySelector('.remote-user-card .voice-volume input').dispatchEvent(new Event('input'))`);
    assert.equal(await run(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => a.muted && a.volume === 0.2)`), true);
    await run(guest, `(async () => { const s=await import('./signaling.js'); s.applyServerState(await s.requestServer('switch-channel',{channelId:'main'})); })()`);
    assert.equal(await run(guest, `document.querySelector('.remote-speaker-button').getAttribute('aria-pressed')`), 'true', 'card rerender preserves local block');
    await run(guest, `document.querySelector('.remote-speaker-button').click()`);
    assert.equal(await run(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => !a.muted && a.volume === 0.2)`), true);
    await run(guest, `document.querySelector('.remote-user-card .voice-volume input').value=50;document.querySelector('.remote-user-card .voice-volume input').dispatchEvent(new Event('input'))`);
    const testChannel = await run(host, `(async () => { const { requestServer } = await import('./signaling.js'); return (await requestServer('create-channel', { name: 'Voice restore' })).channel.id; })()`);
    await run(guest, `(async () => { const { switchChannel } = await import('./room.js'); await switchChannel('${testChannel}'); })()`);
    await wait(guest, `document.querySelector('[data-voice="mute"]').getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-voice="mute"]').disabled`);
    assert.equal(await run(guest, `document.querySelector('[data-voice="deafen"]').getAttribute('aria-pressed')`), 'false');
    await run(guest, `(async () => { const { switchChannel } = await import('./room.js'); await switchChannel('main'); })()`);
    await wait(guest, `voicePCs.filter(pc => pc.connectionState === 'connected').length === 1`);
    await run(host, `(async () => { const { requestServer, socket } = await import('./signaling.js'); const { state } = await import('./shared.js'); await requestServer('set-member-mute', { socketId: state.serverUsers.find(u => u.socketId !== socket.id).socketId, muted: true }); })()`);
    await wait(guest, `document.querySelector('[data-voice="mute"]').disabled && document.querySelector('[data-voice="mute"]').title === '已被管理员禁言'`);
    assert.equal(await run(host, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => a.muted)`), true);
    const peersBeforeMute = await run(guest,'voicePCs.length');
    await run(guest, `window.retainedPeer=voicePCs.find(pc=>pc.connectionState==='connected');document.querySelector('[data-voice="deafen"]').click()`);
    await wait(guest, `retainedPeer.connectionState === 'connected' && document.querySelector('[data-voice="deafen"]').getAttribute('aria-pressed') === 'true'`);
    assert.equal(await run(guest, `localStorage.getItem('voiceMuted') === 'true' && localStorage.getItem('voiceDeafened') === 'true'`), true);
    assert.equal(await run(host, `document.querySelectorAll('audio:not([data-voice-capture])').length`), 1);
    await run(guest, `document.querySelector('#btnSettings').click(); document.querySelector('#btnVoiceDevices').click()`);
    await wait(guest, `document.querySelector('#voiceMicrophone').options.length > 1`);
    await wait(guest, `!document.querySelector('#btnMicrophoneTest').disabled`);
    await run(guest, `document.querySelector('#btnMicrophoneTest').click()`);
    await wait(guest, `document.querySelector('#btnMicrophoneTest').textContent === '停止' && !document.querySelector('#btnMicrophoneTest').disabled`);
    await wait(guest, `document.querySelector('audio[data-microphone-test]') && !document.querySelector('audio[data-microphone-test]').paused`);
    await wait(guest, `Number(document.querySelector('#microphoneLevel').value)>0.001`);
    const beforeSwitch=await run(guest,'capturedMicrophones.length');
    await run(guest, `document.querySelector('#voiceMicrophone').value='alternate';document.querySelector('#voiceMicrophone').dispatchEvent(new Event('change'))`);
    await wait(guest, `capturedMicrophones.length>${beforeSwitch} && !document.querySelector('#voiceMicrophone').disabled && document.querySelector('audio[data-microphone-test]') && !document.querySelector('audio[data-microphone-test]').paused`);
    assert.equal(await run(guest, `capturedMicrophones[0].getTracks().every(t=>t.readyState==='ended') && captureConstraints.at(-1).audio.deviceId.exact==='alternate' && retainedPeer.connectionState==='connected'`),true);
    await run(guest, `document.querySelector('#btnCloseSettings').click();document.querySelector('#btnMemberNetwork').click();document.querySelector('#voiceDiagnostics').open=true`);
    await wait(guest, `document.querySelector('.voice-diagnostics-body').textContent.includes('audio/opus') && !document.querySelector('.voice-diagnostics-body').textContent.includes('RTT—')`);
    await wait(guest, `['接收丢包率（区间）','接收缓冲延迟（区间）','音频接收码率'].every(label=>[...document.querySelectorAll('.voice-diagnostics-row')].some(row=>row.querySelector('span').textContent===label && row.querySelector('strong').textContent!=='—'))`);
    const diagnostics=await run(guest, `document.querySelector('.voice-diagnostics-body').textContent`);
    assert.ok(diagnostics.includes('接收丢包率（区间）') && diagnostics.includes('接收缓冲延迟（区间）'));
    guest.show();await run(guest, `document.querySelector('#voiceDiagnostics').scrollIntoView({block:'end'})`);await new Promise(r=>setTimeout(r,100));
    require('node:fs').writeFileSync(path.join(root,'.runtime-probe','voice-diagnostics.png'),(await guest.webContents.capturePage()).toPNG());
    await run(guest, `document.querySelector('#btnCloseMemberNetwork').click()`);
    await wait(guest, `!document.querySelector('#voiceDiagnostics').open`);
    assert.equal(await run(guest, `retainedPeer.connectionState`), 'connected');
    await wait(guest, `document.querySelector('audio[data-microphone-test]') === null`);
    await run(guest, `document.querySelector('[data-voice="deafen"]').click()`);
    await wait(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a=>!a.muted)`);
    assert.equal(await run(guest,'voicePCs.length'),peersBeforeMute);
    assert.equal(await run(guest,'retainedPeer.connectionState'),'connected');
    await run(guest, `document.querySelector('#btnLeave').click()`);
    await wait(guest, `voicePCs.every(pc=>pc.connectionState==='closed')`);
    assert.equal(await run(guest, `capturedMicrophones.every(s=>s.getTracks().every(t=>t.readyState==='ended'))`), true);
    assert.equal(await run(guest, `captureConstraints.every(c=>c.video===false && c.audio.latency.ideal===0.01)`), true);
    assert.equal(nativeVoiceCalls,0);
    assert.equal(await run(guest, `document.body.innerText.includes('服务器响应超时')`),false);
    console.log('VOICE_UI_OK', JSON.stringify({ syntheticDirectCapture: true, noNativeVoiceRuntime: true, diagnostics: true, automaticPeerRetry: true, realPeerAudio: true, volume: true, mute: true, deafen: true, moderatorMute: true, microphoneTest: true, cleanup: true, interfaces: ips.slice(0, 2) }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { windows.forEach(w => w.destroy()); await new Promise(resolve => io.close(resolve)); app.exit(process.exitCode || 0); }
});
