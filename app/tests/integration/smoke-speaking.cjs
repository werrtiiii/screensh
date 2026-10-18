// Real renderer, signaling and remote WebRTC track. A known tone replaces
// physical microphone input so this regression does not depend on speech.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), assert = require('node:assert/strict');
const { createSignalingServer } = require('../../../server/server');
const root = path.resolve(__dirname, "../..");
app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, '.runtime-probe', `speaking-${process.pid}`));
app.on('window-all-closed', () => {});
ipcMain.handle('voice-start', () => 'test-track');
ipcMain.handle('voice-stop', () => true);
ipcMain.handle('voice-devices', () => [{ id: 'default', name: '测试信号' }]);
ipcMain.handle('get-hardware-acceleration', () => false);
ipcMain.handle('start-easytier', () => '10.144.1.1');
app.whenReady().then(async () => {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  let win;
  const timeout = setTimeout(() => app.exit(1), 60000);
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { backgroundThrottling: false, preload: path.join(root, 'preload.js') } });
    win.webContents.setAudioMuted(true);
    await win.loadFile(path.join(root, 'renderer/index.html'));
    const checking = win.webContents.executeJavaScript(`(async () => {
      await import('./renderer.js');
      window.testContext = new AudioContext(); await testContext.resume();
      window.testGain = testContext.createGain(); testGain.gain.value = 0.1;
      const oscillator = testContext.createOscillator(), output = testContext.createMediaStreamDestination();
      oscillator.connect(testGain).connect(output); oscillator.start();
      window.testSender = new RTCPeerConnection(); window.testReceiver = new RTCPeerConnection();
      const received = new Promise(r => testReceiver.ontrack = e => r(e.track));
      testSender.onicecandidate = e => e.candidate && testReceiver.addIceCandidate(e.candidate);
      testReceiver.onicecandidate = e => e.candidate && testSender.addIceCandidate(e.candidate);
      testSender.addTrack(output.stream.getAudioTracks()[0], output.stream);
      await testSender.setLocalDescription(await testSender.createOffer());
      await testReceiver.setRemoteDescription(testSender.localDescription);
      await testReceiver.setLocalDescription(await testReceiver.createAnswer());
      await testSender.setRemoteDescription(testReceiver.localDescription);
      const track = await received;
      navigator.mediaDevices.getUserMedia=async()=>output.stream.clone();
      localStorage.setItem('voiceMuted', 'false'); localStorage.setItem('voiceDeafened', 'false');
      document.querySelector('#serverUrl').value = 'http://127.0.0.1:${server.address().port}';
      document.querySelector('#userName').value = '发言动效测试';
      document.querySelector('#btnConnect').click();
      window.waitSpeaking = async (active, id) => {
        for (let i = 0; i < 100; i++) {
          const card = id ? [...document.querySelectorAll('.user-card')].find(c => c.dataset.userId === id) : document.querySelector('.user-card');
          if (card && card.classList.contains('is-speaking') === active) return true;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Speaking state did not become ' + active + ' for ' + (id || 'self'));
      };
      await waitSpeaking(true);
      const beforeTest = !document.querySelector('audio[data-microphone-test]');
      document.querySelector('#btnSettings').click(); document.querySelector('#btnMicrophoneTest').click();
      for (let i = 0; i < 100 && document.querySelector('#btnMicrophoneTest').disabled; i++) await new Promise(r => setTimeout(r, 50));
      document.querySelector('#btnMicrophoneTest').click();
      await new Promise(r => setTimeout(r, 600)); await waitSpeaking(true);
      testGain.gain.value = 0; await waitSpeaking(false);
      testGain.gain.value = 0.1; await waitSpeaking(true);
      document.querySelector('[data-voice="mute"]').click(); await waitSpeaking(false);
      // Another member receives the real local meter's activity, then sends
      // its own activity through the server to verify the remote card path.
      const { state } = await import('./shared.js');
      const { requestServer } = await import('./signaling.js');
      const other = io(document.querySelector('#serverUrl').value, { transports: ['websocket'], reconnection: false });
      await new Promise((resolve, reject) => { other.once('connect', resolve); other.once('connect_error', reject); });
      const request = (event, payload) => new Promise((resolve, reject) => other.timeout(2000).emit(event, payload, (error, result) => error || !result.ok ? reject(error || new Error(result.message)) : resolve(result)));
      const access = await request('check-access', { userName: '其他发言者' });
      await request('join-server', { userName: '其他发言者', identity: 'c'.repeat(64), virtualIp: '10.144.1.2', easytierPeers: access.easytierPeers });
      await request('set-voice-state', { enabled: true });
      for (let i = 0; i < 100 && !state.serverUsers.some(u => u.socketId === other.id && u.voiceEnabled); i++) await new Promise(r => setTimeout(r, 50));
      const remoteCard = () => [...document.querySelectorAll('.user-card')].find(c => c.dataset.userId === other.id);
      const waitCard = async predicate => { for (let i = 0; i < 100; i++) { if (predicate(remoteCard())) return; await new Promise(r => setTimeout(r, 30)); } throw new Error('Remote card UI did not update'); };
      await waitCard(card => card?.querySelector('.remote-speaker-button') && !card.querySelector('.remote-mic-muted'));
      if (getComputedStyle(remoteCard().querySelector('.speaker-popover')).display !== 'none') throw new Error('Volume slider should be hidden initially');
      remoteCard().querySelector('.remote-speaker-button').focus();
      if (getComputedStyle(remoteCard().querySelector('.speaker-popover')).display === 'none') throw new Error('Volume slider must open on focus');
      const volume = remoteCard().querySelector('.voice-volume input'); volume.value = 25; volume.dispatchEvent(new Event('input'));
      await request('set-voice-state', { enabled: true, muted: true });
      await waitCard(card => !!card?.querySelector('.remote-mic-muted'));
      await request('set-voice-state', { enabled: true, muted: false });
      await waitCard(card => card && !card.querySelector('.remote-mic-muted'));
      if (remoteCard().querySelector('.voice-volume input').value !== '25') throw new Error('Volume preference was lost on card refresh');
      const activity = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Local speaking was not relayed')), 3000); other.once('voice-activity', event => { clearTimeout(timer); resolve(event); }); });
      document.querySelector('[data-voice="mute"]').click(); await waitSpeaking(true);
      if (!(await activity).speaking) throw new Error('Missing local speaking event');
      document.querySelector('[data-voice="mute"]').click(); await waitSpeaking(false);
      await request('voice-activity', { speaking: true });
      await waitSpeaking(true, other.id);
      await request('voice-activity', { speaking: false }); await waitSpeaking(false, other.id);
      await request('voice-activity', { speaking: true }); await waitSpeaking(true, other.id);
      await requestServer('set-member-mute', { socketId: other.id, muted: true }); await waitSpeaking(false, other.id);
      await waitCard(card => card?.querySelector('.remote-mic-muted')?.title === '已被禁言');
      document.querySelector('#btnCloseSettings').click();
      remoteCard().querySelector('.remote-speaker-button').focus();
      window.cardPreviewReady = true;
      while (!window.cardCaptureDone) await new Promise(r => setTimeout(r, 30));
      await request('voice-activity', { speaking: true }); await waitSpeaking(false, other.id);
      await requestServer('set-member-mute', { socketId: other.id, muted: false });
      await request('voice-activity', { speaking: true }); await waitSpeaking(true, other.id);
      other.disconnect(); await waitSpeaking(false);
      const { stopVoice } = await import('./voice.js'); await stopVoice();
      testSender.close(); testReceiver.close(); await testContext.close();
      return { beforeTest, afterTest: true, silence: true, mute: true, remoteSpeaking: true, remoteSilence: true, remoteModeratorMute: true, remoteVolumePopover: true, remoteMicMuteIcon: true, cleaned: !document.querySelector('[data-voice-capture]') };
    })()`);
    checking.catch(() => {});
    for (let i = 0; i < 250; i++) {
      const ready = await Promise.race([checking.then(() => false), win.webContents.executeJavaScript('!!window.cardPreviewReady')]);
      if (ready) break;
      await new Promise(r => setTimeout(r, 50));
    }
    win.showInactive(); await new Promise(r => setTimeout(r, 200));
    fs.writeFileSync(path.join(root, '.runtime-probe', 'remote-card-volume.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.cardCaptureDone = true');
    const result = await checking;
    assert.ok(result.beforeTest && result.cleaned);
    console.log('SPEAKING_UI_OK', JSON.stringify(result));
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { win?.destroy(); await new Promise(r => io.close(r)); clearTimeout(timeout); app.exit(process.exitCode || 0); }
});
