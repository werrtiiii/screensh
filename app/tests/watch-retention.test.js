const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  const sessions = [], events = [], timers = new Map(), nodes = new Map(); let timerId = 0;
  const state = { roomId: 'room', channelId: 'main', serverUsers: [] };
  const roomUsers = new Map([['peer', { isSharing: true, virtualIp: '10.144.1.2' }], ['other', { isSharing: true, virtualIp: '10.144.1.3' }]]);
  function element() {
    return { classList: { add() {}, remove() {} }, textContent: '', _html: '',
      set innerHTML(value) { this._html = value; this.video = value.includes('<video') ? { paused: true, srcObject: null, pause() { this.paused = true; }, async play() { this.paused = false; } } : null; },
      get innerHTML() { return this._html; }, querySelector() { return this.video; } };
  }
  const $ = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  class Stream { constructor() { this.tracks = []; } addTrack(track) { this.tracks.push(track); } getTracks() { return this.tracks; } }
  class Session {
    constructor(url, _config, track, fail) { this.url = url; this.track = track; this.fail = fail; this.pc = { connectionState: 'connected', addEventListener: (event, fn) => { this[event] = fn; } }; sessions.push(this); }
    async start() { this.started = (this.started || 0) + 1; this.mediaTrack = { stopped: false, stop() { this.stopped = true; } }; this.track({ track: this.mediaTrack }); }
    close() { this.closed = true; this.pc.connectionState = 'closed'; }
  }
  const context = { state, roomUsers, $, socket: { id: 'self', emit: (...args) => events.push(args) }, console,
    document: { pictureInPictureElement: null }, MediaStream: Stream, WhepSession: Session,
    getIceServers() {}, toast() {}, attachVideoStats: () => () => {},
    watchNetwork: () => () => {},
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/media.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.api = { displayRemoteVideo, stopWatch, validateRetainedWatch };', context);
  return { ...context.api, state, roomUsers, sessions, events, timers, $ };
}
test('back detaches audio/video and reuses the same connection within 10 seconds', async () => {
  const f = fixture(); await f.displayRemoteVideo('peer'); const video = f.$('#videoContainer').video;
  f.stopWatch({ retain: true });
  assert.equal(video.paused, true); assert.equal(video.srcObject, null); assert.equal(video.muted, true);
  assert.equal(f.sessions[0].closed, undefined); assert.equal([...f.timers.values()][0].delay, 10000);
  assert.equal(f.events.at(-1)[0], 'stop-viewing');
  await f.displayRemoteVideo('peer');
  assert.equal(f.sessions.length, 1); assert.equal(f.sessions[0].started, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.events.at(-1)[0], 'request-view'); assert.equal(f.$('#videoContainer').video.paused, false);
});
test('expiry closes the media session; watching again opens a new connection', async () => {
  const f = fixture(); await f.displayRemoteVideo('peer'); f.stopWatch({ retain: true });
  [...f.timers.values()][0].fn(); assert.equal(f.sessions[0].closed, true); assert.equal(f.sessions[0].mediaTrack.stopped, true);
  await f.displayRemoteVideo('peer'); assert.equal(f.sessions.length, 2);
});
test('switching target or leaving closes the retained connection immediately', async () => {
  const f = fixture(); await f.displayRemoteVideo('peer'); f.stopWatch({ retain: true }); await f.displayRemoteVideo('other');
  assert.equal(f.sessions[0].closed, true); assert.equal(f.timers.size, 0);
  f.stopWatch({ retain: true }); f.stopWatch(); assert.equal(f.sessions[1].closed, true); assert.equal(f.timers.size, 0);
});
test('stopped sharing or changed channel invalidates a hidden retained session', async () => {
  for (const mutate of [f => { f.roomUsers.get('peer').isSharing = false; }, f => { f.state.channelId = 'new-channel'; }]) {
    const f = fixture(); await f.displayRemoteVideo('peer'); f.stopWatch({ retain: true }); mutate(f); f.validateRetainedWatch();
    assert.equal(f.sessions[0].closed, true); assert.equal(f.timers.size, 0);
  }
});
test('tracks arriving after return stay detached and hidden failures do not retain a dead connection', async () => {
  const f = fixture(); await f.displayRemoteVideo('peer'); f.stopWatch({ retain: true });
  f.sessions[0].track({ track: { stop() {} } }); assert.equal(f.$('#videoContainer').video, null);
  f.sessions[0].fail(new Error('Media stopped')); assert.equal(f.sessions[0].closed, true); assert.equal(f.timers.size, 0);
});

async function fireNext(f) {
  const [id, timer] = f.timers.entries().next().value; f.timers.delete(id); timer.fn(); await new Promise(setImmediate);
}
test('visible watch automatically reconnects after failure and ignores stale callbacks', async () => {
  const f = fixture(); await f.displayRemoteVideo('peer'); const first = f.sessions[0];
  first.fail(Error('network')); first.fail(Error('duplicate'));
  assert.equal(first.closed, true); assert.equal(f.timers.size,1); assert.equal([...f.timers.values()][0].delay,800);
  assert.equal(f.state.watchingId,'peer'); await fireNext(f);
  assert.equal(f.sessions.length,2); assert.equal(f.sessions[1].started,1);
  assert.equal(first.mediaTrack.stopped,true);
  first.fail(Error('late error')); assert.equal(f.timers.size,0); assert.equal(f.state.watchingId,'peer');
  f.stopWatch();
});
test('brief disconnected state recovers without rebuilding; persistent disconnection retries', async () => {
  const f=fixture();await f.displayRemoteVideo('peer');const first=f.sessions[0];
  first.pc.connectionState='disconnected';first.connectionstatechange();
  assert.equal([...f.timers.values()][0].delay,4000);
  first.pc.connectionState='connected';first.connectionstatechange();assert.equal(f.timers.size,0);assert.equal(f.sessions.length,1);
  first.pc.connectionState='disconnected';first.connectionstatechange();await fireNext(f);
  assert.equal(first.closed,true);assert.equal(f.timers.size,1);await fireNext(f);assert.equal(f.sessions.length,2);f.stopWatch();
});
test('retry stops after five attempts, on returning, and when sharing disappears', async () => {
  const f=fixture();await f.displayRemoteVideo('peer');
  for(let i=0;i<5;i++){f.sessions.at(-1).fail(Error('offline'));await fireNext(f);}
  f.sessions.at(-1).fail(Error('offline'));assert.equal(f.state.watchingId,null);assert.equal(f.timers.size,0);assert.equal(f.sessions.length,6);
  await f.displayRemoteVideo('peer');f.sessions.at(-1).fail(Error('offline'));f.stopWatch({retain:true});assert.equal(f.timers.size,0);
  await f.displayRemoteVideo('peer');f.sessions.at(-1).fail(Error('offline'));f.roomUsers.get('peer').isSharing=false;await fireNext(f);
  assert.equal(f.state.watchingId,null);assert.equal(f.timers.size,0);
});
