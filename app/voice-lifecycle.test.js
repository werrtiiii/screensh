const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  const counts = { stops: 0, closes: 0, musicStops: 0, starts: 0 };
  const values = new Map();
  const track = { clone() { return this; }, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const node = { dataset: {}, value: 0, classList: { add() {}, remove() {}, contains() { return false; } }, pause() {}, remove() {}, load() {}, play: async () => {} };
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, state: { roomId: null, serverUsers: [] }, socket: { id: 'self', connected: false },
    localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }, $: () => node,
    document: { querySelectorAll: () => [], body: { append() {} } }, Audio: class { constructor() { Object.assign(this, node); } },
    MediaStream: class { getTracks() { return [track]; } getAudioTracks() { return [track]; } },
    window: { channelAccompaniment: { stop: async () => { counts.musicStops++; }, active: () => true }, electronAPI: { voiceStop: async () => { counts.stops++; } } }, counts, stream,
    requestServer: async () => {}, toast() {}, getIceServers() {} };
  vm.createContext(sandbox);
  const code = fs.readFileSync(require.resolve('./renderer/voice.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(code + `
    paintControls=()=>{}; meter=()=>()=>{}; route=async()=>{}; waitForAudioReady=async()=>{};
    capture=async()=>{ const token=generation; counts.starts++; if(globalThis.delay) await new Promise(r=>globalThis.ready=r); if(token!==generation) throw Error('cancelled'); context ||= {state:'running', close:async()=>{counts.closes++;context.state='closed';}}; rawStream=stream; voiceDestination ||= {stream}; outgoing=voiceDestination.stream; source={disconnect(){}};micGain={gain:{value:1},disconnect(){}};return outgoing; };
    globalThis.api={test:startMicrophoneTest, cancel:stopMicrophoneTest, stop:stopVoice, microphone:changeMicrophone, enable:()=>{voice.enabled=true;}, busy:()=>{voice.busy=true;}, status:()=>({capture:!!rawStream, testing:voice.testing, owns:testOwnsCapture, context:context?.state})};
  `, sandbox);
  return sandbox;
}
test('closing settings during microphone startup drains and stops capture', async () => {
  const f = fixture(); f.delay = true; const pending = f.api.test();
  const stopped = f.api.cancel(); f.ready(); await Promise.all([pending, stopped]);
  assert.equal(f.api.status().capture, false); assert.equal(f.api.status().testing, false); assert.equal(f.counts.stops, 1);
});
test('microphone test cannot start during voice startup', async () => {
  const f = fixture(); f.api.busy(); await f.api.test(); assert.equal(f.counts.starts, 0);
});
test('leaving voice with keepTest retains live capture until test is stopped', async () => {
  const f = fixture(); await f.api.test(); f.api.enable(); await f.api.stop({ keepTest: true });
  assert.equal(f.api.status().testing, true); assert.equal(f.api.status().context, 'running'); assert.equal(f.counts.stops, 0);
  await f.api.cancel(); assert.equal(f.api.status().capture, false); assert.equal(f.counts.closes, 1);
});
test('microphone replacement restores active test without stopping accompaniment or mixer', async () => {
  const f = fixture(); await f.api.test(); f.api.enable(); await f.api.microphone('alternate');
  assert.equal(f.api.status().testing, true); assert.equal(f.api.status().capture, true); assert.equal(f.counts.musicStops, 0); assert.equal(f.counts.closes, 0);
  await f.api.stop();
});

