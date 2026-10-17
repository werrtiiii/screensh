const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { networkInterfaces } = require('node:os');
const { EasyTierLolPing, publicKeyValid } = require('./lolping-easytier.cjs');
const serverId = '12345678-1234-1234-1234-123456789abc';
const event = { kind: 'ping', id: 'danger', d: 1, x: .25, y: .75 };
const validEvent = p => require('./lolping-room.cjs').roomEventValid(p) || ['ping','emote'].includes(p?.kind) && ['danger','facepalm'].includes(p.id) && p.d === 1
  && [p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1);
async function create(t, id, channelId='main', virtualIp='127.0.0.1', allowLoopback=true) {
  const packets=[], context={serverId,channelId,socketId:id,virtualIp};
  const transport=new EasyTierLolPing({context,allowLoopback,validEvent,onPacket:p=>packets.push(p),onError:error=>{throw error;}});
  t.after(()=>transport.stop()); await transport.start();
  return { transport, packets, context, peer: {socketId:id,channelId,virtualIp,name:id,lolpingEndpoint:transport.endpoint} };
}
async function deliver(a,b,bytes) {
  const arrived=once(b.transport.socket,'message');
  a.transport.socket.send(bytes,b.transport.endpoint.port,b.context.virtualIp); await arrived;
}
test('UDP events are encrypted directly between peers; altered and replayed packets cannot render twice', async t=>{
  const a=await create(t,'alice'),b=await create(t,'bob');
  a.transport.updatePeers([b.peer]);b.transport.updatePeers([a.peer]);
  assert.ok(publicKeyValid(a.transport.publicKey));
  let wire;const send=a.transport.socket.send.bind(a.transport.socket);
  a.transport.socket.send=(bytes,...args)=>{wire=Buffer.from(bytes);return send(bytes,...args);};
  const arrived=once(b.transport.socket,'message');a.transport.send(event);await arrived;
  assert.equal(b.packets.length,1);assert.deepEqual(b.packets[0],{...event,from:'alice',name:'alice',serverId,channelId:'main'});
  assert.equal(wire.includes(Buffer.from('danger')),false);assert.equal(wire.includes(Buffer.from('alice')),false);
  const recorded=Buffer.from(wire);await deliver(a,b,recorded);assert.equal(b.packets.length,1,'replay rejected');
  const changed=Buffer.from(recorded);changed[20]^=1;await deliver(a,b,changed);assert.equal(b.packets.length,1,'authentication rejects alteration');
  b.transport.updatePeers([]);await deliver(a,b,recorded);assert.equal(b.packets.length,1,'removed member has no receive route');
  b.transport.updatePeers([a.peer]);await deliver(a,b,recorded);assert.equal(b.packets.length,1,'transient member list changes do not reset replay protection');
});
test('channel isolation and key rotation reject packets from another channel or a previous session', async t=>{
  const a=await create(t,'alice'),b=await create(t,'bob'),c=await create(t,'other','other');
  a.transport.updatePeers([b.peer,c.peer]);assert.equal(a.transport.peers.size,1);
  b.transport.updatePeers([a.peer]);
  let wire;const send=a.transport.socket.send.bind(a.transport.socket);a.transport.socket.send=(bytes,...args)=>{wire=Buffer.from(bytes);return send(bytes,...args);};
  const arrived=once(b.transport.socket,'message');a.transport.send(event);await arrived;const old=Buffer.from(wire);
  const replacement=await create(t,'bob');replacement.transport.updatePeers([a.peer]);
  await deliver(a,replacement,old);assert.equal(replacement.packets.length,0,'new receiver keys reject old in-flight ciphertext');
  a.transport.updatePeers([replacement.peer]);const next=once(replacement.transport.socket,'message');a.transport.send({...event,kind:'emote',id:'facepalm'});await next;
  assert.equal(replacement.packets.length,1);
  // Even a deliberately cross-wired member list cannot cross the channel-bound KDF/AAD.
  c.transport.updatePeers([{...a.peer,channelId:'other'}]);a.transport.updatePeers([{...c.peer,channelId:'main'}]);
  const cross=once(a.transport.socket,'message');c.transport.send(event);await cross;assert.equal(a.packets.length,0);
});
test('production binds only EasyTier IPv4 addresses; cleanup releases sockets and peer keys', async t=>{
  for (const ip of ['0.0.0.0','127.0.0.1','192.168.1.2','10.144.evil']) assert.throws(()=>new EasyTierLolPing({context:{virtualIp:ip}}));
  const a=await create(t,'alice');const socket=a.transport.socket;
  assert.equal(socket.address().address,'127.0.0.1');
  await a.transport.stop();assert.equal(a.transport.socket,null);assert.equal(a.transport.peers.size,0);
  assert.throws(()=>socket.address());
});
test('encrypted UDP preserves validated room messages and strips unknown fields',async t=>{
  const a=await create(t,'alice'),b=await create(t,'bob');a.transport.updatePeers([b.peer]);b.transport.updatePeers([a.peer]);
  for(const e of [{kind:'text',id:'a'.repeat(24),text:'<test> 房间文字',d:1,x:.5,y:.5},{kind:'vote',id:'b'.repeat(24),voteKind:'ready',cohort:'c'.repeat(32)},{kind:'ballot',id:'b'.repeat(24),yes:true},{kind:'presence',textOn:true,votesOn:false,panelOn:true,paused:false,muted:false}]){
    const arrived=once(b.transport.socket,'message');a.transport.send({...e,untrusted:'strip me'});await arrived;
    assert.deepEqual(b.packets.at(-1),{...e,from:'alice',name:'alice',serverId,channelId:'main'});
  }
});
test('available real EasyTier interface can bind two distinct direct UDP endpoints', async t=>{
  const ip=Object.values(networkInterfaces()).flat().find(i=>i.family==='IPv4'&&/^10\.144\./.test(i.address))?.address;
  if(!ip){t.skip('No EasyTier virtual interface on this machine');return;}
  const a=await create(t,'virtual-a','main',ip,false),b=await create(t,'virtual-b','main',ip,false);
  a.transport.updatePeers([b.peer]);b.transport.updatePeers([a.peer]);
  assert.equal(a.transport.socket.address().address,ip);assert.notEqual(a.transport.endpoint.port,b.transport.endpoint.port);
  const arrived=once(b.transport.socket,'message');a.transport.send(event);await arrived;
  assert.equal(b.packets.length,1);console.log('LOLPING_EASYTIER_BOUND',ip);
});
