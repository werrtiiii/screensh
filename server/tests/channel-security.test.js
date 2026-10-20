const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {io:connect} = require('socket.io-client');
const {createSignalingServer} = require('../server');
const request = (socket, event, payload = {}) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, payload, (error, answer) => error ? reject(error) : resolve(answer)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, options = {}) {
  const {server, io} = createSignalingServer({initialPeers:'test.example:11010', ...options});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = []; let closed = false;
  const f = {
    async client(name, index, extra = {}) {
      const socket = connect('http://127.0.0.1:' + server.address().port, {transports:['websocket'], reconnection:false});
      sockets.push(socket); await new Promise(resolve => socket.once('connect', resolve));
      const payload = {userName:name, identity:randomBytes(32).toString('hex'), virtualIp:'10.144.80.' + index, easytierPeers:['tcp://test.example:11010'], ...extra};
      return {socket, payload, joined:await request(socket, 'join-server', payload)};
    },
    async close() {if (closed) return; closed = true; sockets.forEach(socket => socket.disconnect()); await new Promise(resolve => io.close(resolve));},
  };
  t.after(f.close); return f;
}

test('temporary creation is public; persistent creation and channel passwords follow the full permission matrix', async t => {
  const f = await fixture(t), host = await f.client('Host',1), admin = await f.client('Admin',2), member = await f.client('Member',3), other = await f.client('Other',4);
  await request(host.socket,'set-admin',{socketId:admin.socket.id,enabled:true});
  assert.equal((await request(member.socket,'create-channel',{name:'No persistent',temporary:false})).ok,false);
  assert.equal((await request(member.socket,'create-channel',{name:'Invalid',temporary:'yes'})).ok,false);
  const own = await request(member.socket,'create-channel',{name:'Member temporary',temporary:true,passwordEnabled:true,password:'member-secret'});
  assert.equal(own.ok,true); assert.equal(own.channel.temporary,true); assert.equal(own.channel.passwordRequired,true);
  const persistent = await request(admin.socket,'create-channel',{name:'Admin persistent',temporary:false});
  assert.equal(persistent.ok,true); assert.equal(persistent.channel.temporary,false);
  for (const actor of [host, member]) assert.equal((await request(actor.socket,'set-channel-password',{channelId:own.channel.id,enabled:true,password:'updated-secret'})).ok,true);
  for (const actor of [admin, other]) assert.equal((await request(actor.socket,'set-channel-password',{channelId:own.channel.id,enabled:false})).ok,false);
  assert.equal((await request(admin.socket,'set-channel-password',{channelId:persistent.channel.id,enabled:true,password:'admin-secret'})).ok,true);
  await request(host.socket,'set-admin',{socketId:admin.socket.id,enabled:false});
  assert.equal((await request(admin.socket,'set-channel-password',{channelId:persistent.channel.id,enabled:false})).ok,true,'creator keeps password rights after demotion');
  assert.equal((await request(member.socket,'set-channel-password',{channelId:'main',enabled:true,password:'bad'})).ok,false);
  const snapshot = await request(host.socket,'switch-channel',{channelId:'main'});
  const serialized = JSON.stringify(snapshot);
  for (const value of ['updated-secret', 'member-secret', 'salt', '"hash"', '"creator"']) assert.ok(!serialized.includes(value),'password or private creator field is not broadcast: '+value);
  assert.equal(snapshot.channels.find(channel => channel.id===own.channel.id).creatorId,snapshot.memberHistory.find(user => user.name==='Member').memberId);
  assert.equal((await request(member.socket,'set-channel-password',{channelId:own.channel.id,enabled:false})).ok,true);
  assert.equal((await request(host.socket,'switch-channel',{channelId:'main'})).channels.find(channel=>channel.id===own.channel.id).passwordRequired,false);
});

test('passwords protect direct joins and switches; validation leaves voice intact and password changes invalidate old grants', async t => {
  const f=await fixture(t), host=await f.client('Host',1), member=await f.client('Member',2);
  const channel=(await request(host.socket,'create-channel',{name:'Locked',temporary:false,passwordEnabled:true,password:'secret-one'})).channel;
  await request(member.socket,'set-voice-state',{enabled:true});
  for (const password of [undefined,'incorrect']) assert.equal((await request(member.socket,'switch-channel',{channelId:channel.id,password})).ok,false);
  let snapshot=await request(member.socket,'switch-channel',{channelId:'main'});
  assert.equal(snapshot.users.find(user=>user.socketId===member.socket.id).voiceEnabled,true);
  assert.equal((await request(member.socket,'check-channel-access',{channelId:channel.id,password:'secret-one'})).ok,true);
  assert.equal((await request(member.socket,'switch-channel',{channelId:channel.id})).ok,true);
  await request(member.socket,'switch-channel',{channelId:'main'});
  await request(host.socket,'set-channel-password',{channelId:channel.id,enabled:true,password:'secret-two'});
  assert.equal((await request(member.socket,'switch-channel',{channelId:channel.id})).ok,false);
  const outsider=await f.client('Outsider',3,{channelId:channel.id});
  assert.equal(outsider.joined.ok,false);
  assert.equal((await request(outsider.socket,'join-server',{...outsider.payload,channelPassword:'secret-two'})).ok,true);
  await request(host.socket,'set-channel-password',{channelId:'main',enabled:true,password:'main-secret'});
  const lobby=await f.client('Lobby',4);
  assert.equal(lobby.joined.ok,false);
  assert.equal((await request(lobby.socket,'join-server',{...lobby.payload,channelId:null})).ok,true);
  await request(host.socket,'delete-channel',{channelId:channel.id});
  snapshot=await request(host.socket,'switch-channel',{channelId:'main'});
  assert.equal(snapshot.users.find(user=>user.socketId===outsider.socket.id).channelId,null,'deletion must not bypass a locked main channel');
});

test('a brief reconnect resumes a locked channel without replaying its password prompt', async t => {
  const f=await fixture(t,{disconnectGraceMs:1000}), host=await f.client('Host',1), peer=await f.client('Peer',2);
  const channel=(await request(host.socket,'create-channel',{name:'Reconnect',passwordEnabled:true,password:'secret'})).channel;
  await request(peer.socket,'switch-channel',{channelId:channel.id,password:'secret'});
  peer.socket.io.engine.close(); await pause(20);
  const rejoined=await f.client('Peer',2,{identity:peer.payload.identity,channelId:channel.id});
  assert.equal(rejoined.joined.ok,true); assert.equal(rejoined.joined.users.find(user=>user.socketId===rejoined.socket.id).channelId,channel.id);
  await request(rejoined.socket,'leave-server');
  assert.equal((await request(rejoined.socket,'join-server',rejoined.payload)).ok,false,'intentional departure does not grant a new session access');
});

test('parallel password joins cannot put a single socket into multiple channel memberships', async t => {
  const f=await fixture(t), host=await f.client('Host',1);
  const channel=(await request(host.socket,'create-channel',{name:'Parallel',passwordEnabled:true,password:'secret'})).channel;
  const visitor=await f.client('Visitor',2,{channelId:null}); await request(visitor.socket,'leave-server');
  const payload={...visitor.payload,channelId:channel.id,channelPassword:'secret'};
  const answers=await Promise.all([request(visitor.socket,'join-server',payload),request(visitor.socket,'join-server',payload)]);
  assert.equal(answers.filter(answer=>answer.ok).length,1);
  assert.equal(answers.filter(answer=>answer.message==='已进入服务器').length,1);
});

test('channel password guessing is rate limited without disconnecting current members', async t => {
  const f=await fixture(t), host=await f.client('Host',1), member=await f.client('Member',2);
  const channel=(await request(host.socket,'create-channel',{name:'Rate limited',passwordEnabled:true,password:'secret'})).channel;
  for(let i=0;i<20;i++) assert.equal((await request(member.socket,'check-channel-access',{channelId:channel.id,password:'wrong'})).message,'频道密码错误');
  assert.match((await request(member.socket,'check-channel-access',{channelId:channel.id,password:'secret'})).message,/过于频繁/);
  assert.equal((await request(member.socket,'switch-channel',{channelId:'main'})).ok,true);
});

test('empty temporary channels expire; occupied channels survive and a new occupancy cancels the previous deadline', async t => {
  const f=await fixture(t,{temporaryChannelIdleMs:180}), host=await f.client('Host',1);
  const create=async name=>(await request(host.socket,'create-channel',{name,temporary:true})).channel;
  const expired=await create('Empty'), active=await create('Active');
  const persistent=(await request(host.socket,'create-channel',{name:'Persistent',temporary:false})).channel;
  await request(host.socket,'switch-channel',{channelId:active.id}); await pause(230);
  let snapshot=await request(host.socket,'switch-channel',{channelId:active.id});
  assert.ok(!snapshot.channels.some(channel=>channel.id===expired.id));
  assert.ok(snapshot.channels.some(channel=>channel.id===persistent.id));
  assert.ok(snapshot.channels.some(channel=>channel.id===active.id));
  await request(host.socket,'switch-channel',{channelId:'main'}); await pause(100);
  assert.equal((await request(host.socket,'switch-channel',{channelId:active.id})).ok,true); await pause(120);
  assert.equal((await request(host.socket,'switch-channel',{channelId:active.id})).ok,true,'old timer cannot delete a reoccupied channel');
  await request(host.socket,'switch-channel',{channelId:'main'}); await pause(230);
  snapshot=await request(host.socket,'switch-channel',{channelId:'main'});
  assert.ok(!snapshot.channels.some(channel=>channel.id===active.id));
});

test('password hashes, creator permissions and idle deadlines persist across server restarts', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-channel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const stateFile=path.join(dir,'state.json'), f=await fixture(t,{stateFile,temporaryChannelIdleMs:220});
  const host=await f.client('Host',1), member=await f.client('Member',2);
  const channel=(await request(member.socket,'create-channel',{name:'Temporary',temporary:true})).channel;
  const locked=(await request(host.socket,'create-channel',{name:'Saved lock',passwordEnabled:true,password:'persist-secret'})).channel;
  const disk=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.ok(disk.channels.find(item=>item.id===locked.id).password.hash);assert.ok(!JSON.stringify(disk).includes('persist-secret'));
  await f.close();await pause(260);
  const g=await fixture(t,{stateFile,temporaryChannelIdleMs:220});await pause(20);
  const restored=await g.client('Host',1,{identity:host.payload.identity});
  assert.equal(restored.joined.ok,true);
  assert.ok(!restored.joined.channels.some(item=>item.id===channel.id),'restart retains the original empty deadline');
  assert.equal(restored.joined.channels.find(item=>item.id===locked.id).passwordRequired,true);
  assert.equal((await request(restored.socket,'set-channel-password',{channelId:locked.id,enabled:false})).ok,true);
});
