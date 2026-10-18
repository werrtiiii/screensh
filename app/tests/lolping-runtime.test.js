const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { LolPingRuntime } = require('../lolping/runtime.cjs');
const core = require('../lolping/dist/main/core.cjs');
const serverId = '12345678-1234-1234-1234-123456789abc';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-lolping-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const displays = [{ number: 1, id: 7, bounds: { x: 0, y: 0, width: 1000, height: 800 } }], overlays = [], bridges = [], sent = [];
  class Overlay extends EventEmitter {
    constructor() { super(); this.received = []; overlays.push(this); }
    start() {} updateSettings() {} cancelWheel() {} dropKeptPings() {} destroy() { this.destroyed = true; }
    numbered() { return displays; } handle() {}
    spawnRemote(p) { this.received.push(p); } spawnRemoteEmote(p) { this.received.push(p); }
  }
  class Bridge extends EventEmitter {
    constructor() { super(); this.commands = []; bridges.push(this); }
    send(c) { this.commands.push(c); } start() { this.emit('status', 'running'); } async stop() { this.stopped = true; }
  }
  const file = path.join(dir, 'settings.json'), helper = path.join(dir, 'helper.exe'); fs.writeFileSync(helper, 'fixture');
  const transportFactory = () => ({ endpoint: {port:12345}, start:async()=>{}, updatePeers(){}, send:p=>{if(p.kind!=='presence')sent.push(['lolping-udp',p]);}, stop:async()=>{} });
  const runtime = new LolPingRuntime({ file, helper, transportFactory, send: (...args) => sent.push(args), core: { ...core, OverlayManager: Overlay, InputBridge: Bridge } });
  return { runtime, overlays, bridges, sent, file, context: { serverId, channelId: 'main', socketId: 'alice', virtualIp:'10.144.31.1', connected: true } };
}
test('lolPing settings are disabled by default, normalized and persisted separately for each server', async t => {
  const f = fixture(t), r = f.runtime;
  assert.equal(r.get(serverId).config.enabled, false);
  await r.save(serverId, { enabled: true, volume: 999, pingDurationS: -10, allowInternet: true, wheel: ['bad'] });
  const config = r.get(serverId).config; assert.equal(config.volume, 100); assert.equal(config.pingDurationS, 1); assert.equal(config.wheel.length, 8);
  assert.equal(config.allowInternet, undefined);
  const copy = new LolPingRuntime({ file: f.file, helper: '', send() {}, core });
  assert.deepEqual(copy.get(serverId).config, config);
  assert.equal(copy.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa').config.enabled, false);
  assert.throws(() => r.get('../bad'));
});
test('channel changes drop stale events and shutdown/restart without retaining the old hook or overlay', async t => {
  const f = fixture(t), r = f.runtime; await r.save(serverId, { enabled: true }); await r.sync(f.context);
  const old = f.overlays[0], bridge = f.bridges[0];
  old.emit('shared', { id: 'danger', displayId: 7, x: 500, y: 400 });
  assert.equal(f.sent.filter(([channel]) => channel === 'lolping-udp').length, 1);
  const next = r.sync({ ...f.context, channelId: 'new' });
  old.emit('shared', { id: 'danger', displayId: 7, x: 500, y: 400 });
  assert.equal(f.sent.filter(([channel]) => channel === 'lolping-udp').length, 1, 'old queued gesture never enters the new room');
  await next; assert.ok(old.destroyed && bridge.stopped); assert.equal(f.overlays.length, 2);
  const live = f.overlays[1];
  r.receive({ serverId, channelId: 'main', from: 'bob', kind: 'ping', id: 'danger', d: 1, x: .5, y: .5 });
  assert.equal(live.received.length, 0);
  r.receive({ serverId, channelId: 'new', from: 'bob', name: '<b>Bob</b>', kind: 'ping', id: 'danger', d: 1, x: .5, y: .5 });
  assert.equal(live.received[0].x, 500); assert.equal(live.received[0].y, 400);
  await r.sync(null); assert.ok(live.destroyed && f.bridges[1].stopped); assert.equal(r.overlay, null);
  live.emit('shared', { id: 'danger', displayId: 7, x: 500, y: 400 });
  assert.equal(f.sent.filter(([channel]) => channel === 'lolping-udp').length, 1);
});
test('rapid enable and leave cannot start a helper late, and turning off releases a live helper', async t => {
  const f = fixture(t), r = f.runtime; await r.save(serverId, { enabled: true });
  await Promise.all([r.sync(f.context), r.stop()]); assert.equal(f.bridges.length, 0);
  await r.sync(f.context); await r.save(serverId, { enabled: false });
  assert.ok(f.bridges[0].stopped && f.overlays[0].destroyed);
});
test('pause suppresses local and remote gestures; overlay failure releases the input helper', async t => {
  const f = fixture(t), r = f.runtime; await r.save(serverId, { enabled: true }); await r.sync(f.context);
  const overlay = r.overlay, bridge = r.bridge;
  bridge.emit('event', { type: 'toggled', enabled: false });
  overlay.emit('shared', { id: 'danger', displayId: 7, x: 500, y: 400 });
  r.receive({ ...f.context, from: 'bob', kind: 'ping', id: 'danger', d: 1, x: .5, y: .5 });
  assert.equal(f.sent.filter(([channel]) => channel === 'lolping-udp').length, 0); assert.equal(overlay.received.length, 0);
  bridge.emit('event', { type: 'toggled', enabled: true });
  overlay.emit('shared', { id: 'danger', displayId: 7, x: 500, y: 400 });
  assert.equal(f.sent.filter(([channel]) => channel === 'lolping-udp').length, 1);
  overlay.emit('failed'); await r.chain; await new Promise(resolve => setImmediate(resolve));
  assert.ok(bridge.stopped && overlay.destroyed); assert.equal(r.status, 'failed');
});
test('custom key settings reject conflicts; disabling room features releases their native shortcuts',async t=>{
  const f=fixture(t),r=f.runtime;await r.save(serverId,{enabled:true,trigger:{vk:0x47}});await r.sync(f.context);
  assert.equal(f.bridges[0].commands.find(c=>c.type==='config').triggerVk,0x47);
  await assert.rejects(r.save(serverId,{trigger:{vk:13}}),/按键/);
  await assert.rejects(r.save(serverId,{textHotkey:{mods:3,vk:0x50}}),/相同快捷键/);
  await r.save(serverId,{features:{emotes:false,rooms:true,roomText:false,roomVotes:false,roomPanel:false}});
  const command=f.bridges[0].commands.filter(c=>c.type==='config').at(-1);
  assert.equal(command.emoteTrigger,'off');assert.equal(command.textVk,0);assert.equal(command.panelVk,0);
  await r.save(serverId,{features:{rooms:false}});assert.equal(r.transport,null);assert.ok(r.bridge,'local marks remain enabled');await r.stop();
});
test('outside a channel only local gestures run, with no transport or room keys; rejoining restores sync',async t=>{
  const f=fixture(t),r=f.runtime;await r.save(serverId,{enabled:true});
  let created=0;const factory=r.transportFactory;r.transportFactory=options=>{created++;return factory(options);};
  assert.equal(await r.sync({...f.context,channelId:null,virtualIp:null,peers:[{socketId:'ignored'}]}),undefined);
  assert.ok(r.overlay&&r.bridge);assert.equal(r.transport,null);assert.equal(r.room,null);assert.equal(created,0);
  const local=r.overlay,command=r.bridge.commands.find(c=>c.type==='config');assert.equal(command.textVk,0);assert.equal(command.panelVk,0);
  local.emit('shared',{id:'danger',displayId:7,x:500,y:400});local.emit('sharedEmote',{ref:'facepalm',displayId:7,x:500,y:400});
  r.bridge.emit('event',{type:'textRequested'});r.bridge.emit('event',{type:'panel',show:true});assert.equal(r.windows,null);
  r.receive({serverId,channelId:null,from:'bob',kind:'ping',id:'danger',d:1,x:.5,y:.5});assert.equal(local.received.length,0);
  assert.equal(f.sent.filter(([channel])=>channel==='lolping-udp').length,0);
  await r.sync(f.context);assert.ok(r.transport&&r.room);assert.equal(created,1);assert.ok(local.destroyed);
  local.emit('shared',{id:'danger',displayId:7,x:500,y:400});local.emit('failed');assert.ok(r.overlay&&r.transport,'stale local overlay cannot affect a joined room');
  assert.equal(f.sent.filter(([channel])=>channel==='lolping-udp').length,0,'old local effects are never forwarded after joining');
  r.overlay.emit('shared',{id:'danger',displayId:7,x:500,y:400});assert.equal(f.sent.filter(([channel])=>channel==='lolping-udp').length,1);
  await r.sync({...f.context,channelId:null});assert.equal(r.transport,null);assert.equal(r.room,null);assert.ok(r.overlay&&r.bridge);
  await r.save(serverId,{enabled:false});assert.equal(r.overlay,null);assert.equal(r.bridge,null);
});
