const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  const counts = { stops: 0, closes: 0, musicStops: 0, starts: 0 };
  const values = new Map();
  const track = { clone() { return { stop() {} }; }, stop() { counts.stops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const node = { dataset: {}, value: 0, classList: { add() {}, remove() {}, contains() { return false; } }, pause() {}, remove() {}, load() {}, play: async () => {} };
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, state: { roomId: null, serverUsers: [] }, socket: { id: 'self', connected: false },
    localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }, $: () => node,
    document: { querySelectorAll: () => [], body: { append() {} } }, Audio: class { constructor() { Object.assign(this, node); } },
    MediaStream: class { constructor(tracks = [{ stop() {} }]) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks; } },
    window: { channelAccompaniment: { stop: async () => { counts.musicStops++; }, active: () => true }, electronAPI: { voiceStop: async () => { counts.stops++; } } }, counts, stream,
    requestServer: async () => {}, toast() {}, getIceServers() {} };
  vm.createContext(sandbox);
  const code = fs.readFileSync(require.resolve('./renderer/voice.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(code + `
    paintControls=()=>{}; meter=()=>()=>{}; route=async()=>{}; waitForAudioReady=async()=>{};
    capture=async()=>{ const token=generation; counts.starts++; if(globalThis.delay) await new Promise(r=>globalThis.ready=r); if(token!==generation) throw Error('cancelled'); context ||= {state:'running', close:async()=>{counts.closes++;context.state='closed';}}; rawStream=stream; voiceDestination ||= {stream:new MediaStream()}; outgoing=voiceDestination.stream; source={disconnect(){}};micGain={gain:{value:1},disconnect(){}};return outgoing; };
    globalThis.api={test:startMicrophoneTest, cancel:stopMicrophoneTest, stop:stopVoice, microphone:changeMicrophone, enable:()=>{voice.enabled=true;}, busy:()=>{voice.busy=true;}, status:()=>({capture:!!rawStream, testing:voice.testing, owns:testOwnsCapture, context:context?.state})};
  `, sandbox);
  return sandbox;
}
test('closing settings during microphone startup drains and stops capture', async () => {
  const f = fixture(); f.delay = true; const pending = f.api.test();
  const stopped = f.api.cancel(); f.ready(); await Promise.all([pending, stopped]);
  assert.equal(f.api.status().capture, false); assert.equal(f.api.status().testing, false); assert.equal(f.counts.stops, 0);
});
test('microphone test cannot start during voice startup', async () => {
  const f = fixture(); f.api.busy(); await f.api.test(); assert.equal(f.counts.starts, 0);
});

test('joining during microphone test startup connects voice once the test is ready', async () => {
  const f = fixture(); f.delay = true;
  const pending = f.api.test();
  f.state.roomId = 'room'; f.state.channelId = 'main'; f.state.virtualIp = '10.144.1.1'; f.socket.connected = true;
  vm.runInContext('voice.muted=true;voice.deafened=true;syncVoice();syncVoice()', f);
  assert.equal(vm.runInContext('voice.enabled', f), false);
  f.ready(); await pending; await new Promise(setImmediate);
  assert.equal(vm.runInContext('voice.enabled', f), true);
  assert.equal(f.api.status().testing, true);
  assert.equal(f.counts.starts, 1, 'voice reuses the active test capture');
  await f.api.cancel();
  assert.equal(vm.runInContext('voice.enabled', f), true, 'closing the test preserves channel voice');
  assert.equal(f.counts.stops, 0);
  await f.api.stop();
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

test('channel voice starts with both controls off and toggling both off retains capture', async () => {
  const f = fixture(); f.state.roomId = 'room'; f.state.channelId = 'main'; f.state.virtualIp = '10.144.1.1'; f.socket.connected = true;
  vm.runInContext('voice.muted=true;voice.deafened=true;syncVoice()', f);
  await new Promise(setImmediate);
  assert.equal(vm.runInContext('voice.enabled',f),true); assert.equal(f.counts.starts,1);
  f.window.channelAccompaniment.active=()=>false;
  await vm.runInContext("changeVoicePreference('deafen')",f);
  await vm.runInContext("changeVoicePreference('deafen')",f);
  assert.equal(vm.runInContext('voice.enabled && voice.muted && voice.deafened',f),true);
  assert.equal(f.counts.stops,0); assert.equal(f.counts.starts,1);
  await f.api.stop(); assert.equal(f.counts.stops,1);
});

test('leaving the server releases microphone tracks without requesting acknowledgement from a closing socket',async()=>{
  const f=fixture();await f.api.test();f.api.enable();f.state.leaving=true;f.socket.connected=true;
  let requests=0;f.requestServer=async()=>{requests++;throw Error('socket is closing');};
  await f.api.stop();assert.equal(requests,0);assert.equal(f.counts.stops,1);assert.equal(f.api.status().capture,false);
});

