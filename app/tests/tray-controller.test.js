const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTrayController } = require('../main/tray-controller.cjs');
test('closing hides window, tray restores it, and explicit quit permits closing', () => {
  let tray, menu, quitting = false, quits = 0, hidden = 0, shown = 0, focused = 0, restored = 0;
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, isMinimized: () => true, hide: () => hidden++, show: () => shown++, focus: () => focused++, restore: () => restored++ });
  class Tray extends EventEmitter {
    constructor() { super(); tray = this; }
    setToolTip() {} setContextMenu(value) { menu = value; } isDestroyed() { return !!this.dead; } destroy() { this.dead = true; }
  }
  const controller = createTrayController({ Tray, Menu: { buildFromTemplate: value => value }, nativeImage: { createFromBitmap: buffer => { assert.equal(buffer.length, 4096); return {}; } } }, { getWindow: () => win, canClose: () => quitting, quit: () => { quits++; quitting = true; } });
  controller.attach(win); let prevented = 0;
  win.emit('close', { preventDefault: () => prevented++ }); assert.equal(hidden, 1); assert.equal(prevented, 1);
  tray.emit('double-click'); assert.equal(shown, 1); assert.equal(restored, 1); assert.equal(focused, 1);
  menu.find(item => item.label === '退出').click(); assert.equal(quits, 1);
  win.emit('close', { preventDefault: () => prevented++ }); assert.equal(prevented, 1);
  controller.destroy(); controller.destroy(); assert.equal(tray.dead, true);
});
