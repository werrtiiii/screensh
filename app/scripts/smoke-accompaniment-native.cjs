const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const { ObsEngine } = require('../obs-engine');
const { VoiceRuntime } = require('../voice-runtime.cjs');
const { listCaptureSources } = require('../capture-sources');
const root = path.resolve(__dirname, '..'), temporary = path.join(root, '.runtime-probe', 'accompaniment-native-' + process.pid);
fs.mkdirSync(temporary, { recursive: true }); app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const failures = [], failure = message => failures.push(message);
  const obs = new ObsEngine(path.join(temporary, 'sources'));
  const voice = new VoiceRuntime(path.join(temporary, 'voice'), path.join(root, 'res/mediamtx.exe'), path.join(root, 'mediamtx.yml'), failure);
  const music = new VoiceRuntime(path.join(temporary, 'music'), path.join(root, 'res/mediamtx.exe'), path.join(root, 'mediamtx.yml'), failure, { httpPort: 8891, icePort: 8191, sourceType: 'accompaniment' });
  let player, probe;
  const timeout = setTimeout(() => { console.error('ACCOMPANIMENT_NATIVE_TIMEOUT'); app.exit(1); }, 60000);
  try {
    player = new BrowserWindow({ show: false, width: 400, height: 240, title: 'ScreenSh accompaniment native probe' });
    await player.loadURL('data:text/html,<title>ScreenSh accompaniment native probe</title><p>Accompaniment capture probe</p>'); player.showInactive();
    await player.webContents.executeJavaScript(`(async () => { window.audio = new AudioContext(); const oscillator = audio.createOscillator(), gain = audio.createGain(); gain.gain.value = 0.02; oscillator.connect(gain).connect(audio.destination); oscillator.start(); await audio.resume(); })()`, true);
    obs.init();
    const source = listCaptureSources(obs.osn, []).find(s => s.type === 'window' && s.name.includes('ScreenSh accompaniment native probe'));
    assert.ok(source, 'Native process audio source must be selectable');
    await voice.start('default');
    const url = await music.start(source.id);
    const html = path.join(temporary, 'probe.html');
    fs.writeFileSync(html, `<!doctype html><script type="module">
      import { WhepSession } from '../../renderer/whep.mjs';
      window.probe = async url => {
        const context = new AudioContext(); await context.resume(); const stream = new MediaStream();
        let trackReady; const ready = new Promise(resolve => trackReady = resolve);
        const session = new WhepSession(url, {}, event => { if (event.track.kind === 'audio') { stream.addTrack(event.track); trackReady(); } }, console.error, { audioOnly: true });
        const sink = new Audio(); sink.volume = 0;
        try {
          await session.start(); await ready; sink.srcObject = stream; await sink.play();
          const input = context.createMediaStreamSource(stream), analyser = context.createAnalyser(), silent = context.createGain(); silent.gain.value = 0; input.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
          const samples = new Float32Array(analyser.fftSize);
          for (let i = 0; i < 100; i++) { analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length); if (rms > 0.0001) return rms; await new Promise(resolve => setTimeout(resolve, 100)); }
          throw new Error('Native accompaniment returned silent audio');
        } finally { sink.pause(); sink.srcObject = null; session.close(); await context.close(); }
      };
    </script>`);
    probe = new BrowserWindow({ show: false }); await probe.loadFile(html);
    const rms = await probe.webContents.executeJavaScript(`window.probe('${url}')`, true);
    assert.ok(voice.active, 'Starting accompaniment must not stop the microphone host');
    await music.stop(); assert.ok(voice.active);
    assert.equal(failures.length, 0, failures.join('; '));
    console.log('ACCOMPANIMENT_NATIVE_OK', JSON.stringify({ processAudioWaveform: rms, microphoneIsolation: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { player?.destroy(); probe?.destroy(); obs.shutdown(); await music.stop(); await voice.stop(); clearTimeout(timeout); app.exit(process.exitCode || 0); }
});
