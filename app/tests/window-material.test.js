const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachWindowMaterial } = require('../main/window-material.cjs');

test('native backdrop and corner preferences are repaired after maximize and restore', async () => {
  let maximized = false, fullscreen = false;
  const calls = [], states = [];
  const contents = new EventEmitter(); contents.send = (channel, state) => states.push([channel, state]);
  const win = Object.assign(new EventEmitter(), {
    webContents: contents, isDestroyed: () => false, isMaximized: () => maximized, isFullScreen: () => fullscreen,
    getNativeWindowHandle: () => { const handle = Buffer.alloc(8); handle.writeBigUInt64LE(123n); return handle; },
  });
  const controller = attachWindowMaterial(win, { nativeGlass: true, repair: async (...args) => calls.push(args), delay: 0 });
  await controller.refresh();
  maximized = true; win.emit('maximize'); await controller.refresh();
  assert.equal(calls.at(-1)[1], false, 'maximized windows have square outer corners');
  assert.equal(states.at(-1)[1].maximized, true);
  maximized = false; win.emit('unmaximize'); await controller.refresh();
  assert.deepEqual(calls.at(-1), ['123', true], 'restore reapplies the rounded frame and glass');
  fullscreen = true; win.emit('enter-full-screen'); await controller.refresh();
  assert.equal(calls.at(-1)[1], false);
  win.emit('closed');
  const count = calls.length; await controller.refresh(); assert.equal(calls.length, count);
});

test('unsupported systems still publish window state without invoking Windows APIs', async () => {
  const contents = new EventEmitter(); contents.send = () => {};
  const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false, isMaximized: () => false, isFullScreen: () => false });
  const controller = attachWindowMaterial(win, { nativeGlass: false, repair: () => assert.fail('native repair on unsupported system') });
  await controller.refresh(); win.emit('closed');
});
