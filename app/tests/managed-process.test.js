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
