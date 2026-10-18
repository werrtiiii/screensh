const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const nodes = [];
  function stream() {
    const track = { kind: 'audio', enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  }
  function node(kind) {
    const value = { kind, connections: new Set(), gain: { value: 1 },
      connect(target) { this.connections.add(target); }, disconnect() { this.connections.clear(); } };
    if (kind === 'destination') value.stream = stream();
    nodes.push(value); return value;
  }
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval,
    state: { serverUsers: [] }, socket: { id: 'self' },
    localStorage: { getItem: () => null }, document: { querySelectorAll: () => [] },
    window: {}, AbortController, captureMicrophone: async () => stream(),
    AudioContext: class {
      state = 'running';
      resume() { return Promise.resolve(); }
      createMediaStreamSource() { return node('source'); }
      createGain() { return node('gain'); }
      createMediaStreamDestination() { return node('destination'); }
    }, nodes, makeStream: stream,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(require.resolve('../renderer/voice.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(code + `
    meter=()=>()=>{};
    globalThis.api={capture, update:updateOutgoing,
      volume:async value=>{microphoneVolume=value;applyMute();await updateOutgoing();},
      music:mixAccompaniment, enable:()=>{voice.enabled=true;},
      snapshot:()=>({raw:rawStream,outgoing,source,gain:micGain,destination:voiceDestination})};
  `, sandbox);
  return sandbox;
}

test('direct capture never creates a microphone mixer; gain changes connect it on demand and release it', async () => {
  const f = fixture(); await f.api.capture();
  assert.equal(f.nodes.length, 0);
  assert.equal(f.api.snapshot().outgoing, f.api.snapshot().raw);
  await f.api.volume(0.5);
  const mix = f.api.snapshot();
  assert.ok(mix.source.connections.has(mix.gain));
  assert.ok(mix.gain.connections.has(mix.destination));
  assert.equal(mix.gain.gain.value, 0.5);
  await f.api.volume(0.3);
  assert.equal(f.api.snapshot().destination, mix.destination);
  await f.api.volume(1);
  assert.equal(mix.source.connections.size, 0);
  assert.equal(mix.gain.connections.size, 0);
  assert.equal(mix.destination.stream.getTracks()[0].readyState, 'ended');
  assert.equal(f.api.snapshot().destination, null);
  assert.equal(f.api.snapshot().raw.getTracks()[0].readyState, 'live');
});

test('music creates the mixer from direct capture and disposes it only after the final attachment', async () => {
  const f = fixture(); await f.api.capture(); f.api.enable();
  const first = await f.api.music(f.makeStream(), 0.8);
  const mix = f.api.snapshot();
  const second = await f.api.music(f.makeStream(), 0.4);
  first.dispose(); first.dispose(); await f.api.update();
  assert.equal(f.api.snapshot().destination, mix.destination);
  assert.equal(mix.source.connections.size, 1);
  second.dispose(); await f.api.update();
  assert.equal(f.api.snapshot().outgoing, mix.raw);
  assert.equal(f.api.snapshot().source, null);
  assert.equal(f.api.snapshot().destination, null);
});

test('returning to direct capture waits for replaceTrack before stopping the mixed track', async () => {
  const f = fixture(); await f.api.capture(); await f.api.volume(0.5);
  const mix = f.api.snapshot();
  let finish;
  f.sender = { track: mix.outgoing.getAudioTracks()[0], replaceTrack(track) {
    return new Promise(resolve => { finish = () => { this.track = track; resolve(); }; });
  } };
  vm.runInContext(`peers.set('remote',{audio:{},pc:{getSenders:()=>[sender]}});`, f);
  const direct = f.api.volume(1);
  await new Promise(setImmediate);
  assert.equal(mix.source.connections.size, 0);
  assert.equal(mix.destination.stream.getTracks()[0].readyState, 'live');
  finish(); await direct;
  assert.equal(f.sender.track, mix.raw.getAudioTracks()[0]);
  assert.equal(mix.destination.stream.getTracks()[0].readyState, 'ended');
  assert.equal(f.api.snapshot().destination, null);
});
