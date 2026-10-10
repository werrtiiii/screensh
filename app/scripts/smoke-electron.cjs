// Hidden Electron integration test: synthetic OBS source -> WHIP -> WHEP -> decoded frame.
const { app, BrowserWindow, screen } = require('electron');
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const root = process.env.SCREENSH_TEST_APP_ROOT || path.resolve(__dirname, '..');
const { listCaptureSources } = require(path.join(root, 'capture-sources'));
const localIp = Object.values(require('os').networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))?.address || '127.0.0.1';
const { ManagedProcess } = require(path.join(root, 'managed-process'));
const { ObsEngine } = require(path.join(root, 'obs-engine'));
const temporary = path.resolve(__dirname, '../.runtime-probe');
fs.mkdirSync(temporary, { recursive: true });
app.setPath('userData', path.join(temporary, `electron-${process.pid}`));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
process.chdir(temporary);
class SyntheticEngine extends ObsEngine {
  createSource() { return this.osn.InputFactory.create('color_source_v3', `test-${Date.now()}`, { width: 640, height: 360, color: 0xffff6600 }); }
}
const mtx = new ManagedProcess('MediaMTX-test');
const testPort = Number(process.env.SCREENSH_TEST_PORT || 8889);
const mediaPort = Number(process.env.SCREENSH_TEST_MEDIA_PORT || 8189);
const obs = new SyntheticEngine(temporary, undefined, `http://127.0.0.1:${testPort}/live/whip`);
app.whenReady().then(async () => {
  let window, fixture;
  try {
    await mtx.start(path.join(root, process.env.SCREENSH_TEST_APP_ROOT ? '../mediamtx.exe' : 'res/mediamtx.exe'), [path.join(root, 'mediamtx.yml')], {
      cwd: temporary, ready: log => /\[WebRTC\] listener opened/.test(log),
      env: { ...process.env, MTX_WEBRTCADDRESS: `127.0.0.1:${testPort}`, MTX_WEBRTCLOCALUDPADDRESS: `${localIp}:${mediaPort}`, MTX_WEBRTCLOCALTCPADDRESS: `${localIp}:${mediaPort}`, MTX_WEBRTCIPSFROMINTERFACES: 'false', MTX_WEBRTCADDITIONALHOSTS: localIp },
    });
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(path.join(__dirname, 'smoke-player.html'), { query: { port: String(testPort) } });
    fixture = new BrowserWindow({ show: false, x: 20, y: 20, width: 640, height: 400, title: 'ScreenSh capture test', backgroundColor: '#0066ff' });
    await fixture.loadURL('data:text/html,<title>ScreenSh capture test</title><body style="background:%230066ff">ScreenSh capture test</body>');
    fixture.showInactive();
    await new Promise(resolve => setTimeout(resolve, 500));
    obs.init();
    const sources = listCaptureSources(obs.osn, screen.getAllDisplays());
    assert.ok(sources.some(s => s.type === 'screen'), 'No monitors enumerated');
    console.log('CAPTURE_SOURCES', JSON.stringify({ monitors: sources.filter(s => s.type === 'screen'), windows: sources.filter(s => s.type === 'window').length }));
    for (let i = 0; i < 2; i++) {
      mtx.output = '';
      await obs.start({ sourceId: 'Auto', videoEncoder: process.env.SCREENSH_TEST_ENCODER || 'x264', resolution: i ? 'auto' : '1280x720', frameRate: i ? 60 : 15, maxBitrate: i ? 900 : 2400, audioBitrate: 128, shareAudio: false });
      await mtx.waitForOutput(/\[path live\] stream is available/);
      const decoded = await window.webContents.executeJavaScript('verifyStream()');
      assert.equal(decoded.width, i ? 640 : 1280);
      assert.equal(decoded.height, i ? 360 : 720);
      assert.ok(decoded.rgb[2] > 180 && decoded.rgb[0] < 40, 'Expected blue test source');
      assert.ok(Number.isFinite(parseFloat(decoded.stats['解码帧率'])), 'Stats should report a measured frame rate, including zero for a stalled decoder');
      assert.ok(parseFloat(decoded.stats['视频接收码率']) > 0, 'Stats should report received bitrate');
      console.log('DECODED_VIDEO', i + 1, JSON.stringify(decoded));
      obs.stop();
    }
    const windowSource = sources.find(s => s.type === 'window' && s.name.includes('ScreenSh capture test'));
    assert.ok(windowSource, 'Test window missing from OBS source list');
    obs.createSource = ObsEngine.prototype.createSource;
    await fixture.webContents.executeJavaScript(`document.body.innerHTML = ['red','lime','yellow','magenta'].map((c,i)=>'<div style="position:fixed;width:60px;height:60px;background:'+c+';'+(i%2?'right':'left')+':0;'+(i<2?'top':'bottom')+':0"></div>').join('')`);
    fixture.setSize(1000, 700);
    await new Promise(resolve => setTimeout(resolve, 400));
    mtx.output = '';
    await obs.start({ sourceId: windowSource.id, sourceType: 'window', resolution: '854x480', frameRate: 30, maxBitrate: 2400, audioBitrate: 128, shareAudio: false });
    await mtx.waitForOutput(/\[path live\] stream is available/);
    console.log('WINDOW_FOUR_CORNERS', JSON.stringify(await window.webContents.executeJavaScript('verifyStream(null, true)')));
    fixture.setSize(1400, 900);
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log('RESIZED_FOUR_CORNERS', JSON.stringify(await window.webContents.executeJavaScript('verifyStream(null, true)')));
    obs.stop();
    mtx.output = '';
    await obs.start({ sourceId: windowSource.id, sourceType: 'window', resolution: 'auto', frameRate: 30, maxBitrate: 0, audioBitrate: 128, shareAudio: false });
    await mtx.waitForOutput(/\[path live\] stream is available/);
    console.log('WINDOW_CAPTURE_VIDEO', JSON.stringify(await window.webContents.executeJavaScript('verifyStream()')));
    obs.stop();
    const monitor = sources.find(s => s.type === 'screen');
    await fixture.webContents.executeJavaScript(`(async () => {
      window.testAudio = new AudioContext();
      const oscillator = testAudio.createOscillator();
      const gain = testAudio.createGain(); gain.gain.value = 0.02;
      oscillator.connect(gain).connect(testAudio.destination); oscillator.start();
      await testAudio.resume();
      return testAudio.state;
    })()`, true);
    console.log('FIXTURE_AUDIO', await fixture.webContents.executeJavaScript('testAudio.state'), fixture.webContents.isAudioMuted());
    mtx.output = '';
    await obs.start({ sourceId: windowSource.id, sourceType: 'window', resolution: 'auto', frameRate: 30, maxBitrate: 0, audioBitrate: 128, shareAudio: true });
    await mtx.waitForOutput(/\[path live\] stream is available/);
    console.log('WINDOW_CAPTURE_AUDIO', JSON.stringify(await window.webContents.executeJavaScript('verifyStream(true)')));
    obs.stop();
    mtx.output = '';
    await obs.start({ sourceId: windowSource.id, sourceType: 'window', resolution: 'auto', frameRate: 30, maxBitrate: 0, audioBitrate: 128, shareAudio: false });
    await mtx.waitForOutput(/\[path live\] stream is available/);
    console.log('WINDOW_AUDIO_DISABLED', JSON.stringify(await window.webContents.executeJavaScript('verifyStream(false)')));
    obs.stop();
    await fixture.webContents.executeJavaScript('testAudio.close()');
    for (const captureMethod of ['auto', 'wgc']) {
    mtx.output = '';
    const capture = await obs.start({ sourceId: monitor.id, sourceType: 'screen', captureMethod, resolution: 'auto', frameRate: 30, maxBitrate: 0, audioBitrate: 128, shareAudio: false });
    await mtx.waitForOutput(/\[path live\] stream is available/);
    const desktop = await window.webContents.executeJavaScript('verifyStream()');
    assert.equal(desktop.width, capture.width - capture.width % 4);
    assert.equal(desktop.height, capture.height - capture.height % 2);
    console.log('MONITOR_CAPTURE_VIDEO', captureMethod, JSON.stringify(desktop));
    obs.stop();
    }
    console.log('ELECTRON_MEDIA_SMOKE_OK');
  } catch (error) {
    console.error(error.stack); process.exitCode = 1;
    if (window) {
      const frame = await window.webContents.executeJavaScript('({image:window.lastTestFrame,corners:window.lastCornersFound})');
      console.log('CORNERS', frame.corners);
      if (frame.image) fs.writeFileSync(path.join(temporary, 'window-fit.png'), Buffer.from(frame.image.split(',')[1], 'base64'));
    }
  }
  finally { fixture?.destroy(); window?.destroy(); obs.shutdown(); await mtx.stop(); app.exit(process.exitCode || 0); }
});

