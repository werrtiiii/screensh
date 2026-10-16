// Production browser capture and visible level meter. Optional Chromium test input.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
if (process.env.SCREENSH_FAKE_MIC === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
app.setPath('userData', path.join(root, '.runtime-probe', `mic-meter-${process.pid}`));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const name of ['voice-devices','voice-start','voice-stop']) ipcMain.handle(name, () => { throw Error('Microphone capture must not start OBS'); });
  ipcMain.handle('get-hardware-acceleration', () => false);
  let win;
  const timeout = setTimeout(() => app.exit(1), 90000);
  try {
    win = new BrowserWindow({ show: true, webPreferences: { backgroundThrottling: false, preload: path.join(root, 'preload.js') } });
    // Do not feed automated monitoring back into an open microphone.
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', (_, level, message) => console.log('RENDERER', message));
    await win.loadFile(path.join(root, 'renderer/index.html'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      await import('./renderer.js');
      const { refreshVoiceDevices } = await import('./voice.js');
      document.querySelector('#btnSettings').click();
      await refreshVoiceDevices();
      if (${process.env.SCREENSH_MIC_COMPARE === '1'}) {
        const ref = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext(); await ctx.resume();
        const src = ctx.createMediaStreamSource(ref), analyser = ctx.createAnalyser();
        src.connect(analyser); const silent = ctx.createGain(); silent.gain.value = 0; analyser.connect(silent).connect(ctx.destination);
        const samples = new Float32Array(analyser.fftSize); let peak = 0;
        for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 100)); analyser.getFloatTimeDomainData(samples); peak = Math.max(peak, ...samples.map(Math.abs)); }
        console.log('REFERENCE_MIC', JSON.stringify({ peak, settings: ref.getAudioTracks()[0].getSettings() }));
        ref.getTracks().forEach(t => t.stop()); await ctx.close();
      }
      const selected = ${JSON.stringify(process.env.SCREENSH_TEST_MIC || 'default')};
      localStorage.setItem('voiceMicrophone', selected);
      document.querySelector('#btnMicrophoneTest').click();
      const values = []; let started = false;
      for (let i = 0; i < 200; i++) {
        await new Promise(r => setTimeout(r, 100));
        const audio = document.querySelector('audio[data-microphone-test]');
        started ||= !!audio && !audio.paused;
        values.push(Number(document.querySelector('#microphoneLevel').value));
      }
      return { selected, started, peak: Math.max(...values), nonzero: values.filter(v => v > 0.001).length,
        status: document.querySelector('#voiceTestStatus').classList.contains('hidden') ? '' : document.querySelector('#voiceTestStatus').textContent };
    })()`);
    fs.writeFileSync(path.join(root, '.runtime-probe/mic-meter.png'), (await win.webContents.capturePage()).toPNG());
    console.log('MIC_METER_RESULT', JSON.stringify(result));
    if (!result.started || result.peak <= 0.001) throw new Error('麦克风测试未收到可测声音：音量条验证失败（不能将静音 RTP 包算作通过）');
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#btnMicrophoneTest').click();
      for (let i = 0; i < 100 && document.querySelector('#btnMicrophoneTest').disabled; i++) await new Promise(r => setTimeout(r, 100));
      if (document.querySelector('audio[data-microphone-test]') || Number(document.querySelector('#microphoneLevel').value) !== 0) throw new Error('停止测试后播放器或音量条未清理');
    })()`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { win?.destroy(); clearTimeout(timeout); app.exit(process.exitCode || 0); }
});
