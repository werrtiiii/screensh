const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../renderer/rendering-settings.mjs');
function checkbox() {
  return { checked: false, disabled: false, addEventListener(_event, fn) { this.change = fn; } };
}
test('hardware preference waits for authoritative loading and rolls back failed writes', async () => {
  const { bindRenderingSettings } = await load();
  const box = checkbox(), messages = [];
  let resolveRead;
  const binding = bindRenderingSettings(box, {
    getHardwareAcceleration: () => new Promise(resolve => { resolveRead = resolve; }),
    setHardwareAcceleration: async () => { throw new Error('write failed'); },
  }, (...args) => messages.push(args));
  assert.equal(box.disabled, true);
  resolveRead(true); await binding;
  assert.equal(box.checked, true); assert.equal(box.disabled, false);
  box.checked = false; await box.change();
  assert.equal(box.checked, true); assert.equal(box.disabled, false);
  assert.deepEqual(messages, [['write failed', 'error']]);
});
test('pending hardware save blocks competing changes and reflects only saved value', async () => {
  const { bindRenderingSettings } = await load();
  const box = checkbox(); let finish, calls = 0;
  await bindRenderingSettings(box, {
    getHardwareAcceleration: async () => false,
    setHardwareAcceleration: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  }, () => {});
  box.checked = true; const pending = box.change();
  assert.equal(box.disabled, true);
  box.checked = false; await box.change();
  assert.equal(calls, 1);
  finish(true); await pending;
  assert.equal(box.checked, true); assert.equal(box.disabled, false);
});
test('hardware read failure does not enable a control with an unknown preference', async () => {
  const { bindRenderingSettings } = await load(); const box = checkbox();
  await bindRenderingSettings(box, { getHardwareAcceleration: async () => { throw new Error('offline'); } }, () => {});
  assert.equal(box.disabled, true); assert.equal(box.change, undefined);
});
