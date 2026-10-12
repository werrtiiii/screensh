const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(setImmediate);

// Run the real renderer function bodies with deterministic DOM and IPC doubles.
// Browser module loading and real rendering remain covered by test:ui.
function renderer(ipc = {}) {
  const nodes = new Map(), notifications = [];
  function element() {
    const classes = new Set();
    return {
      textContent: '', innerHTML: '', disabled: false,
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name),
      },
      querySelector: () => null, addEventListener() {},
    };
  }
  const $ = name => { if (!nodes.has(name)) nodes.set(name, element()); return nodes.get(name); };
  $('#room').classList.add('active');
  $('#runtimeCleanupStatus').classList.add('hidden');
  $('#btnRetryCleanup').classList.add('hidden');
  const api = { startSharing: async () => ({}), stopSharing: async () => {}, leaveRuntime: async () => {}, ...ipc };
  const context = vm.createContext({
    console, setTimeout, clearTimeout, closeContextMenu() {},
    document: { querySelector: $, querySelectorAll: () => [], pictureInPictureElement: null },
    window: { electronAPI: api },
    socket: { connected: true, id: 'self', emit() {} }, roomUsers: new Map(), disconnectSignaling() {},
    toast: message => notifications.push(message),
  });
  for (const file of ['shared.js', 'media.js', 'room.js']) {
    const source = fs.readFileSync(path.join(__dirname, 'renderer', file), 'utf8')
      .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context, { filename: file });
  }
  vm.runInContext('globalThis.testApi = { state, startScreenCapture, stopSharing, leaveRoom, updateSharingUI };', context);
  const { state } = context.testApi;
  Object.assign(state, { roomId: 'test', virtualIp: '10.144.1.1', isSharing: true, autoPreview: false });
  context.testApi.updateSharingUI(true);
  return { ...context.testApi, $, ipc: api, notifications };
}

test('renderer disables sharing until stop completes and coalesces repeated clicks', async () => {
  const gate = deferred();
  let stops = 0, starts = 0;
  const r = renderer({ stopSharing: () => { stops++; return gate.promise; }, startSharing: async () => { starts++; } });
  const stop = r.stopSharing();
  assert.equal(r.stopSharing(), stop);
  await tick();
  assert.equal(stops, 1);
  assert.equal(r.state.stoppingShare, true);
  assert.equal(r.$('#btnShare').disabled, true);
  assert.equal(r.$('#btnConfirmShare').disabled, true);
  assert.equal(r.$('#btnStopShare').textContent, '正在停止…');
  r.state.selectedSourceId = 0;
  await r.startScreenCapture();
  assert.equal(starts, 0);
  gate.resolve();
  assert.equal(await stop, true);
  assert.equal(r.state.stoppingShare, false);
  assert.equal(r.$('#btnShare').disabled, false);
  await r.startScreenCapture();
  assert.equal(starts, 1);
  assert.equal(r.state.isSharing, true);
});

test('failed stop keeps a retry action and blocks restart until cleanup succeeds', async () => {
  const r = renderer({ stopSharing: async () => { throw new Error('exit failed'); } });
  assert.equal(await r.stopSharing(), false);
  assert.equal(r.state.shareCleanupFailed, true);
  assert.equal(r.$('#btnStopShare').textContent, '重试停止');
  assert.equal(r.$('#btnStopShare').disabled, false);
  assert.equal(r.$('#btnShare').classList.contains('hidden'), true);
  assert.ok(r.notifications.some(text => text.includes('exit failed')));
  r.ipc.stopSharing = async () => {};
  assert.equal(await r.stopSharing(), true);
  assert.equal(r.state.shareCleanupFailed, false);
  assert.equal(r.$('#btnShare').classList.contains('hidden'), false);
});

test('late startup completion cannot re-enable sharing while a stop is pending', async () => {
  const startGate = deferred(), stopGate = deferred();
  const r = renderer({ startSharing: () => startGate.promise, stopSharing: () => stopGate.promise });
  r.state.isSharing = false;
  r.state.selectedSourceId = 0;
  const start = r.startScreenCapture();
  const stop = r.stopSharing();
  startGate.resolve();
  await start;
  assert.equal(r.state.isSharing, false);
  assert.equal(r.$('#btnShare').disabled, true);
  assert.equal(r.$('#btnConfirmShare').disabled, true);
  stopGate.resolve();
  await stop;
  assert.equal(r.$('#btnShare').disabled, false);
});

test('leaving waits for cleanup, reports failure persistently, and supports retry', async () => {
  const stopGate = deferred(), leaveGate = deferred();
  let leaves = 0;
  const r = renderer({ stopSharing: () => stopGate.promise, leaveRuntime: () => { leaves++; return leaveGate.promise; } });
  const leave = r.leaveRoom();
  await tick();
  assert.equal(leaves, 1, 'network cleanup must not wait for the separate stop IPC');
  assert.equal(r.$('#room').classList.contains('active'), true);
  assert.equal(r.$('#btnLeave').textContent, '正在清理…');
  assert.equal(r.$('#btnConnect').disabled, true);
  stopGate.reject(new Error('media stop failed'));
  leaveGate.reject(new Error('media cleanup failed; network stopped'));
  await leave;
  assert.equal(r.state.leaving, false);
  assert.equal(r.state.runtimeCleanupFailed, true);
  assert.equal(r.$('#lobby').classList.contains('active'), true);
  assert.ok(r.$('#runtimeCleanupStatus').textContent.includes('media cleanup failed'));
  assert.equal(r.$('#runtimeCleanupStatus').classList.contains('hidden'), false);
  assert.equal(r.$('#btnRetryCleanup').classList.contains('hidden'), false);
  assert.equal(r.$('#btnConnect').disabled, true);
  r.ipc.stopSharing = async () => {};
  r.ipc.leaveRuntime = async () => {};
  await r.leaveRoom();
  assert.equal(r.state.runtimeCleanupFailed, false);
  assert.equal(r.state.shareCleanupFailed, false);
  assert.equal(r.$('#runtimeCleanupStatus').classList.contains('hidden'), true);
  assert.equal(r.$('#btnRetryCleanup').classList.contains('hidden'), true);
  assert.equal(r.$('#btnConnect').disabled, false);
});

