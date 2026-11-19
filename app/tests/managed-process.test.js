const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ManagedProcess } = require('../main/managed-process');
test('missing executable rejects, never reports ready', async () => {
  const p = new ManagedProcess('missing');
  await assert.rejects(p.start('screensh-no-such-executable.exe', [], { timeout: 1000 }), /missing/);
  await p.stop();
});
test('timeout rejects and terminates child', async () => {
  const p = new ManagedProcess('timeout');
  await assert.rejects(p.start(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 }), /超时/);
  await p.stop(); assert.equal(p.child, null);
});
test('cancel pending startup and start again', async () => {
  const p = new ManagedProcess('cancel');
  const pending = p.start(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  const rejected = assert.rejects(pending, /取消/);
  await p.stop(); await rejected;
  await p.start(process.execPath, ['-e', 'console.log("READY");setInterval(()=>{},1000)'], { ready: text => text.includes('READY') });
  assert.ok(p.child); await p.stop(); assert.equal(p.child, null);
});
test('async probes must finish successfully and never overlap', async () => {
  const p = new ManagedProcess('async probe');
  let calls = 0, finishFirstProbe, firstProbeStarted;
  const first = new Promise(resolve => { firstProbeStarted = resolve; });
  const started = p.start(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    probe: () => {
      if (++calls > 1) return true;
      return new Promise(resolve => { finishFirstProbe = resolve; firstProbeStarted(); });
    },
  });
  try {
    await Promise.race([first, started.then(() => assert.fail('startup resolved before probing'))]);
    const result = await Promise.race([started.then(() => 'started'), new Promise(resolve => setTimeout(resolve, 250, 'pending'))]);
    assert.equal(result, 'pending');
    assert.equal(calls, 1);
    finishFirstProbe(false);
    await started;
    assert.equal(calls, 2);
  } finally {
    finishFirstProbe?.(false);
    await p.stop();
  }
});
