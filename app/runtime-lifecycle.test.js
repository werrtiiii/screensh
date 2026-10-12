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
const config = { sourceId: 0, resolution: '1280x720', frameRate: 30, maxBitrate: 1500, audioBitrate: 128, shareAudio: false };

// Execute the actual IPC handlers; only Electron and native resources are mocked.
function runtime() {
  const handlers = new Map(), processes = new Map();
  let obs;
  class FakeProcess {
    constructor(name) { this.name = name; this.child = null; this.startCalls = 0; this.stopCalls = 0; processes.set(name, this); }
    async start() {
      this.startCalls++;
      if (this.child) throw new Error(`${this.name} 已在运行或启动中`);
      this.child = {};
      if (this.startGate) await this.startGate.promise;
    }
    async stop() {
      this.stopCalls++;
      if (this.stopGate) await this.stopGate.promise;
      if (this.stopError) throw this.stopError;
      this.child = null;
    }
    async waitForOutput() {}
  }
  class FakeObs {
    constructor() { obs = this; this.streaming = null; this.startCalls = 0; this.stopCalls = 0; }
    async start() {
      this.startCalls++;
      if (this.startError) throw this.startError;
      this.streaming = {};
      if (this.startGate) await this.startGate.promise;
      return { width: 1280, height: 720 };
    }
    stop() {
      this.stopCalls++;
      if (this.stopError) throw this.stopError;
      this.streaming = null;
    }
  }
  const electron = {
    app: { isPackaged: false, getPath: () => '.', requestSingleInstanceLock: () => true, whenReady: () => ({ then: fn => fn() }), on() {} },
    BrowserWindow: class { constructor() { this.webContents = { on() {}, send() {} }; } loadFile() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
    screen: {},
  };
  const dependencies = {
    electron, './capture-sources': {}, './managed-process': { ManagedProcess: FakeProcess },
    './obs-engine': { ObsEngine: FakeObs }, './peer-test': { createPeerTester: () => ({ stop: async () => {} }) },
  };
  const context = vm.createContext({
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    __dirname, process, console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') + `
    globalThis.roomAddress = { get: () => virtualIp, set: value => { virtualIp = value; } };
  `, context, { filename: 'main.js' });
  context.roomAddress.set('10.144.1.1');
  return {
    start: () => handlers.get('start-sharing')(null, config),
    stop: () => handlers.get('stop-sharing')(),
    leave: () => handlers.get('leave-runtime')(),
    address: context.roomAddress, obs, media: processes.get('MediaMTX'), network: processes.get('EasyTier'),
  };
}

test('rapid restart waits for process exit and concurrent stops share one cleanup', async () => {
  const r = runtime();
  await r.start();
  const gate = r.media.stopGate = deferred();
  const stop = r.stop();
  assert.equal(r.stop(), stop);
  const restart = r.start();
  await tick();
  assert.equal(r.media.startCalls, 1);
  assert.equal(r.media.stopCalls, 1);
  assert.equal(r.obs.stopCalls, 1);
  gate.resolve();
  await stop;
  await restart;
  assert.equal(r.media.startCalls, 2);
  assert.ok(r.obs.streaming);
});

test('stop drains an in-flight OBS start before the next generation starts', async () => {
  const r = runtime();
  const gate = r.obs.startGate = deferred();
  const first = assert.rejects(r.start(), /取消/);
  await tick();
  const stop = r.stop();
  let stopped = false;
  stop.then(() => { stopped = true; });
  const restart = r.start();
  await tick();
  assert.equal(stopped, false);
  assert.equal(r.media.startCalls, 1);
  assert.equal(r.media.stopCalls, 1);
  r.obs.startGate = null;
  gate.resolve();
  await first;
  await stop;
  await restart;
  assert.equal(r.obs.startCalls, 2);
  assert.equal(r.media.stopCalls, 1, 'the cancelled start must not stop the new generation');
  assert.ok(r.obs.streaming);
});

test('stop during MediaMTX startup never starts OBS for the cancelled generation', async () => {
  const r = runtime();
  const gate = r.media.startGate = deferred();
  const start = assert.rejects(r.start(), /取消/);
  await tick();
  const stop = r.stop();
  await tick();
  gate.resolve();
  await start;
  await stop;
  assert.equal(r.obs.startCalls, 0);
  assert.equal(r.media.stopCalls, 1);
});

test('failed stop blocks queued restart and can be retried', async () => {
  const r = runtime();
  await r.start();
  r.media.stopError = new Error('synthetic exit failure');
  const stop = assert.rejects(r.stop(), /synthetic exit failure/);
  const restart = assert.rejects(r.start(), /synthetic exit failure/);
  await Promise.all([stop, restart]);
  assert.equal(r.media.startCalls, 1);
  r.media.stopError = null;
  await r.stop();
  await r.start();
  assert.equal(r.media.startCalls, 2);
});

test('normal startup failure rolls back resources and releases the startup guard', async () => {
  const r = runtime();
  r.obs.startError = new Error('synthetic capture failure');
  await assert.rejects(r.start(), /synthetic capture failure/);
  assert.equal(r.media.child, null);
  assert.equal(r.media.stopCalls, 1);
  r.obs.startError = null;
  await r.start();
  assert.ok(r.obs.streaming);
});

test('leaving attempts network cleanup despite media failure and clears room access', async () => {
  const r = runtime();
  await r.start();
  r.network.child = {};
  r.media.stopError = new Error('synthetic media failure');
  const leave = r.leave();
  assert.equal(r.leave(), leave, 'duplicate leave calls must coalesce');
  assert.equal(r.address.get(), null);
  await assert.rejects(leave, /synthetic media failure/);
  assert.equal(r.network.stopCalls, 1);
  assert.equal(r.network.child, null);
  assert.equal(r.address.get(), null);
  await assert.rejects(r.start(), /先加入房间/);
  r.media.stopError = null;
  await r.leave();
  assert.equal(r.media.child, null);
});

test('leaving independently cleans every resource and reports all failures', async () => {
  const r = runtime();
  r.obs.stopError = new Error('obs failed');
  r.media.stopError = new Error('media failed');
  r.network.stopError = new Error('network failed');
  await assert.rejects(r.leave(), error => {
    for (const message of ['obs failed', 'media failed', 'network failed']) assert.ok(error.message.includes(message));
    return true;
  });
  assert.equal(r.obs.stopCalls, 1);
  assert.equal(r.media.stopCalls, 1);
  assert.equal(r.network.stopCalls, 1);
  assert.equal(r.address.get(), null);
});

test('network cleanup starts while media shutdown is still pending', async () => {
  const r = runtime();
  await r.start();
  const gate = r.media.stopGate = deferred();
  const leave = r.leave();
  await tick();
  assert.equal(r.network.stopCalls, 1);
  assert.equal(r.address.get(), null);
  gate.resolve();
  await leave;
});
