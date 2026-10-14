// Real native OBS hosts; enumerate only, without recording or publishing audio.
const path = require('path');
const assert = require('assert/strict');
const { ObsEngine } = require('../obs-engine');
const { VoiceRuntime } = require('../voice-runtime.cjs');
const { listCaptureSources } = require('../capture-sources');
const root = path.resolve(__dirname, '..');
const temporary = path.join(root, '.runtime-probe', `isolation-${process.pid}`);
const obs = new ObsEngine(path.join(temporary, 'screen'));
const voice = new VoiceRuntime(path.join(temporary, 'voice'), path.join(root, 'res/mediamtx.exe'), path.join(root, 'mediamtx.yml'), error => { throw new Error(error); });
(async () => {
  try {
    obs.init();
    const initial = listCaptureSources(obs.osn, []);
    assert.ok(initial.some(source => source.type === 'screen'));
    for (let i = 0; i < 3; i++) {
      assert.ok((await voice.devices()).length);
      assert.ok(listCaptureSources(obs.osn, []).some(source => source.type === 'screen'));
      await voice.stop();
      obs.stop();
      assert.ok(listCaptureSources(obs.osn, []).some(source => source.type === 'screen'));
    }
    await voice.devices();
    obs.shutdown(); obs.init();
    assert.ok((await voice.devices()).length);
    assert.ok(listCaptureSources(obs.osn, []).some(source => source.type === 'screen'));
    console.log('OBS_ISOLATION_OK: repeated microphone restart and screen host restart');
  } finally { await voice.stop(); obs.shutdown(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
