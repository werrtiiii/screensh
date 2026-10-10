// Run with Electron's Node runtime. Uses a generated color, never desktop/audio capture.
const path = require('path');
const fs = require('fs');
const { ManagedProcess } = require('../managed-process');
const { ObsEngine } = require('../obs-engine');
const root = path.resolve(__dirname, '..');
const temporary = path.join(root, '.runtime-probe');
fs.mkdirSync(temporary, { recursive: true });
process.chdir(temporary);
class SyntheticEngine extends ObsEngine {
  createSource() { return this.osn.InputFactory.create('color_source_v3', `test-${Date.now()}`, { width: 640, height: 360, color: 0xffff6600 }); }
}
const mtx = new ManagedProcess('MediaMTX-test');
const obs = new SyntheticEngine(temporary, message => console.error('OUTPUT FAILURE:', message));
(async () => {
  try {
    await mtx.start(path.join(root, 'res/mediamtx.exe'), [path.join(root, 'mediamtx.yml')], {
      cwd: temporary, ready: log => /\[WebRTC\] listener opened/.test(log),
      env: { ...process.env, MTX_WEBRTCADDRESS: '127.0.0.1:8889', MTX_WEBRTCLOCALUDPADDRESS: '127.0.0.1:8189', MTX_WEBRTCADDITIONALHOSTS: '127.0.0.1' },
    });
    for (let i = 0; i < 2; i++) {
      const result = await obs.start({ sourceId: 'Auto', videoEncoder: process.env.SCREENSH_TEST_ENCODER || 'x264', resolution: '1280x720', frameRate: 30, maxBitrate: 1500, audioBitrate: 128, shareAudio: false });
      console.log('NATIVE_STREAM_STARTED', i + 1, JSON.stringify(result));
      await new Promise(resolve => setTimeout(resolve, 1000));
      obs.stop();
      if (i === 0 && process.env.SCREENSH_TEST_IDLE) {
        await new Promise(resolve => setTimeout(resolve, 31000));
        if (obs.initialized || obs.hosted) throw new Error('OBS did not shut down while idle');
        console.log('OBS_IDLE_SHUTDOWN_OK');
      }
    }
  } finally { obs.shutdown(); await mtx.stop(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
