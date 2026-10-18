const { app, BrowserWindow } = require('electron');
const path = require('path'), assert = require('assert/strict');
const { ProcessAudio } = require('../../main/process-audio.cjs');
app.setPath('userData', path.resolve(__dirname, "../../.runtime-probe/process-audio-" + process.pid));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let player, energy = 0, samples = 0, failure;
  const capture = new ProcessAudio(path.resolve(__dirname, "../../res/screensh-process-audio.exe"), message => {
    const bytes = Buffer.from(message.data);
    for (let i = 0; i < bytes.length; i += 2) { const value = bytes.readInt16LE(i) / 32768; energy += value * value; samples++; }
  }, error => { failure = error; });
  try {
    const existing = new Set((await capture.list()).map(source => source.pid));
    player = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await player.loadURL('data:text/html,<title>Background music fixture</title>');
    await player.webContents.executeJavaScript(`window.audio = new AudioContext(); const tone = audio.createOscillator(), gain = audio.createGain(); gain.gain.value = 0.01; tone.connect(gain).connect(audio.destination); tone.start(); audio.resume();`, true);
    await new Promise(r => setTimeout(r, 700));
    const sources = await capture.list();
    const source = sources.find(source => !existing.has(source.pid) && /electron/i.test(source.name));
    assert.ok(source, 'Hidden Electron player audio session must be listed');
    await capture.start(source.pid);
    player.hide(); player.setTitle('Changed title while hidden');
    await new Promise(r => setTimeout(r, 1800));
    assert.equal(failure, undefined); assert.ok(samples > 48000); assert.ok(Math.sqrt(energy / samples) > 0.001, 'Hidden player PCM must contain music');
    await capture.stop();
    console.log('BACKGROUND_PROCESS_AUDIO_OK', JSON.stringify({ samples, rms: Math.sqrt(energy / samples), hidden: true, titleIndependent: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { await capture.stop().catch(() => {}); player?.destroy(); app.exit(process.exitCode || 0); }
});
