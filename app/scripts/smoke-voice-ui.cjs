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
  ipcMain.handle('voice-start', () => 'test-microphone'); ipcMain.handle('voice-stop', () => true);
  ipcMain.handle('voice-devices', () => [{ id: 'default', name: 'Test signal' }, { id: 'alternate', name: 'Alternate signal' }]);
  ipcMain.handle('get-hardware-acceleration', () => false);
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
      await run(win, `(async () => { await import('./renderer.js'); const { WhepSession } = await import('./whep.mjs'); window.toneContext = new AudioContext(); await toneContext.resume(); const osc = toneContext.createOscillator(), gain = toneContext.createGain(), out = toneContext.createMediaStreamDestination(); gain.gain.value = 0.03; osc.connect(gain).connect(out); osc.start(); WhepSession.prototype.start = async function () { this.pc.ontrack({ track: out.stream.getAudioTracks()[0].clone() }); }; WhepSession.prototype.deleteResource = () => {}; window.voicePCs = []; const PC = RTCPeerConnection; window.RTCPeerConnection = class extends PC { constructor(...args) { super(...args); voicePCs.push(this); }
        get localDescription() { const d = super.localDescription; return d && { type: d.type, sdp: d.sdp.split('${ips[0]}').join('10.144.1.${i+1}') }; }
        set onicecandidate(fn) { super.onicecandidate = fn && (e => { if (!e.candidate) return fn(e); const c = e.candidate.toJSON(); c.candidate = c.candidate.split('${ips[0]}').join('10.144.1.${i+1}'); fn({candidate:{...c,toJSON:()=>c}}); }); }
        async setRemoteDescription(d) { return super.setRemoteDescription({type:d.type,sdp:d.sdp.replace(/10\\.144\\.1\\.[12]/g,'${ips[0]}')}); }
        async addIceCandidate(c) { return super.addIceCandidate({...c,candidate:c.candidate.replace(/10\\.144\\.1\\.[12]/g,'${ips[0]}')}); } }; document.querySelector('#serverUrl').value = 'http://127.0.0.1:${server.address().port}'; document.querySelector('#userName').value = 'Voice ${i}'; document.querySelector('#btnConnect').click(); })()`);
      await wait(win, `document.querySelector('#room').classList.contains('active')`);
      await wait(win, `(async () => { const { state } = await import('./shared.js'); return state.serverUsers.some(u => u.name === 'Voice ${i}' && u.voiceEnabled) && !document.querySelector('[data-voice="mute"]').disabled; })()`);
    }
    for (const win of windows) {
      await wait(win, `voicePCs.filter(pc => pc.connectionState === 'connected').length === 1`);
      const stats = await run(win, `(async () => { const result = []; for (const pc of voicePCs) { const stats = await pc.getStats(); for (const s of stats.values()) if (s.type === 'inbound-rtp' && s.kind === 'audio') result.push(s.packetsReceived); } return result; })()`);
      assert.equal(stats.length, 1); assert.ok(stats.every(count => count > 0));
    }
    const [host, guest] = windows;
    const beforeRetry = await run(host, 'voicePCs.length');
    await run(host, `{ const pc = voicePCs.find(pc => pc.connectionState === 'connected'); Object.defineProperty(pc, 'connectionState', { configurable: true, value: 'failed' }); pc.onconnectionstatechange(); delete pc.connectionState; }`);
    await wait(host, `voicePCs.length > ${beforeRetry} && voicePCs.filter(pc => pc.connectionState === 'connected').length === 1`);

    await run(guest, `document.querySelector('[data-voice="mute"]').click(); const volume = document.querySelector('.voice-volume input'); volume.value = 25; volume.dispatchEvent(new Event('input'));`);
    assert.equal(await run(guest, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => !a.muted && a.volume === 0.25)`), true);
    const testChannel = await run(host, `(async () => { const { requestServer } = await import('./signaling.js'); return (await requestServer('create-channel', { name: 'Voice restore' })).channel.id; })()`);
    await run(guest, `(async () => { const { switchChannel } = await import('./room.js'); await switchChannel('${testChannel}'); })()`);
    await wait(guest, `document.querySelector('[data-voice="mute"]').getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-voice="mute"]').disabled`);
    assert.equal(await run(guest, `document.querySelector('[data-voice="deafen"]').getAttribute('aria-pressed')`), 'false');
    await run(guest, `(async () => { const { switchChannel } = await import('./room.js'); await switchChannel('main'); })()`);
    await wait(guest, `voicePCs.filter(pc => pc.connectionState === 'connected').length === 1`);
    await run(host, `(async () => { const { requestServer, socket } = await import('./signaling.js'); const { state } = await import('./shared.js'); await requestServer('set-member-mute', { socketId: state.serverUsers.find(u => u.socketId !== socket.id).socketId, muted: true }); })()`);
    await wait(guest, `document.querySelector('[data-voice="mute"]').disabled && document.querySelector('[data-voice="mute"]').title === '已被管理员禁言'`);
    assert.equal(await run(host, `[...document.querySelectorAll('audio:not([data-voice-capture])')].every(a => a.muted)`), true);
    await run(guest, `document.querySelector('[data-voice="deafen"]').click()`);
    await wait(guest, `voicePCs.every(pc => pc.connectionState === 'closed')`);
    assert.equal(await run(guest, `localStorage.getItem('voiceMuted') === 'true' && localStorage.getItem('voiceDeafened') === 'true'`), true);
    await wait(host, `document.querySelectorAll('audio:not([data-voice-capture])').length === 0`);
    await run(guest, `document.querySelector('#btnSettings').click(); document.querySelector('#btnVoiceDevices').click()`);
    await wait(guest, `document.querySelector('#voiceMicrophone').options.length > 1`);
    await wait(guest, `!document.querySelector('#btnMicrophoneTest').disabled`);
    await run(guest, `document.querySelector('#btnMicrophoneTest').click()`);
    await wait(guest, `document.querySelector('#btnMicrophoneTest').textContent === '停止测试' && !document.querySelector('#btnMicrophoneTest').disabled`);
    await wait(guest, `document.querySelector('audio[data-microphone-test]') && !document.querySelector('audio[data-microphone-test]').paused`);
    await run(guest, `document.querySelector('#btnCloseSettings').click()`);
    await wait(guest, `voicePCs.every(pc => pc.connectionState === 'closed')`);
    await wait(guest, `document.querySelector('audio[data-microphone-test]') === null`);
    console.log('VOICE_UI_OK', JSON.stringify({ syntheticCaptureBridge: true, automaticPeerRetry: true, realPeerAudio: true, volume: true, mute: true, deafen: true, moderatorMute: true, microphoneTest: true, cleanup: true, interfaces: ips.slice(0, 2) }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { windows.forEach(w => w.destroy()); await new Promise(resolve => io.close(resolve)); app.exit(process.exitCode || 0); }
});
