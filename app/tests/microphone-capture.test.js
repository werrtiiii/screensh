const { test } = require('node:test');
const assert = require('node:assert/strict');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function microphoneStream() {
  let stops = 0;
  const track = { readyState: 'live', stop() { stops++; this.readyState = 'ended'; } };
  return { stream: { getAudioTracks: () => [track], getTracks: () => [track] }, stops: () => stops };
}
test('direct microphone requests audio only with low-latency preferences and exact device selection', async () => {
  const { captureMicrophone } = await import('../renderer/microphone-capture.mjs');
  const mic = microphoneStream(); let requested;
  const result = await captureMicrophone('chosen', { mediaDevices: { getUserMedia: async constraints => { requested = constraints; return mic.stream; } } });
  assert.equal(result, mic.stream); assert.equal(requested.video, false);
  assert.deepEqual(requested.audio.deviceId, { exact: 'chosen' }); assert.equal(requested.audio.latency.ideal, 0.01);
  await captureMicrophone('default', { mediaDevices: { getUserMedia: async constraints => { assert.equal(constraints.audio.deviceId, undefined); return mic.stream; } } });
});
test('cancelled microphone startup rejects promptly and releases a late permission result', async () => {
  const { captureMicrophone } = await import('../renderer/microphone-capture.mjs');
  const pending = deferred(), mic = microphoneStream(), controller = new AbortController();
  const result = captureMicrophone('default', { signal: controller.signal, mediaDevices: { getUserMedia: () => pending.promise } });
  await Promise.resolve();
  controller.abort(); await assert.rejects(result, error => error.code === 'REQUEST_CANCELLED');
  pending.resolve(mic.stream); await new Promise(setImmediate); assert.equal(mic.stops(), 1);
});

test('audio processing defaults off and each processing switch is independent', async () => {
  const { captureMicrophone } = await import('../renderer/microphone-capture.mjs');
  const keys = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];
  for (const enabled of [null, ...keys]) {
    let requested;
    await captureMicrophone('default', { processing: enabled ? { [enabled]: true } : undefined,
      mediaDevices: { getUserMedia: async constraints => { requested = constraints.audio; return microphoneStream().stream; } } });
    for (const key of keys) assert.equal(requested[key], key === enabled);
  }
});
test('cancelling before the permission request starts never opens the microphone', async () => {
  const { captureMicrophone } = await import('../renderer/microphone-capture.mjs');
  const controller = new AbortController(); let requests = 0;
  const result = captureMicrophone('default', { signal: controller.signal, mediaDevices: { getUserMedia: () => { requests++; } } });
  controller.abort(); await assert.rejects(result, error => error.code === 'REQUEST_CANCELLED');
  await new Promise(setImmediate); assert.equal(requests, 0);
});
test('microphone permission timeout releases late tracks and errors are localized', async () => {
  const { captureMicrophone } = await import('../renderer/microphone-capture.mjs');
  const pending = deferred(), mic = microphoneStream();
  await assert.rejects(captureMicrophone('default', { timeout: 5, mediaDevices: { getUserMedia: () => pending.promise } }), /麦克风启动超时/);
  pending.resolve(mic.stream); await new Promise(setImmediate); assert.equal(mic.stops(), 1);
  for (const [name, message] of [['NotAllowedError', /允许此软件访问麦克风/], ['NotFoundError', /未找到麦克风/], ['OverconstrainedError', /所选麦克风当前不可用/], ['NotReadableError', /独占/]]) {
    await assert.rejects(captureMicrophone('chosen', { mediaDevices: { getUserMedia: async () => { throw { name }; } } }), message);
  }
});
