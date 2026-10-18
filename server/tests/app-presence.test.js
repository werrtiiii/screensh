const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { io: connect } = require('socket.io-client');
const { createSignalingServer } = require('../server');
const identity = () => randomBytes(32).toString('hex');
const request = (socket, event, payload = {}) => new Promise((resolve, reject) => socket.timeout(2000).emit(event, payload, (error, answer) => error ? reject(error) : resolve(answer)));
async function setup(t, options = {}) {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010', disconnectGraceMs: 0, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await new Promise(resolve => io.close(resolve)); });
  return async () => {
    const socket = connect('http://127.0.0.1:' + server.address().port, { transports: ['websocket'], reconnection: false });
    clients.push(socket); await new Promise(resolve => socket.once('connect', resolve)); return socket;
  };
}
const join = (socket, name, key, ip) => request(socket, 'join-server', { userName: name, identity: key, virtualIp: ip, easytierPeers: ['tcp://test.example:11010'] });
const snapshot = socket => request(socket, 'switch-channel', { channelId: 'main' });
test('software presence survives leaving a server without joining rooms or gaining permissions', async t => {
  const client = await setup(t), host = await client(), user = await client(), presence = await client();
  await join(host, 'Owner', identity(), '10.144.1.1');
  const key = identity(), joined = await join(user, 'Visitor', key, '10.144.1.2');
  const payload = { serverId: joined.serverId, identity: key };
  assert.equal((await request(presence, 'app-presence', payload)).ok, true);
  await request(user, 'leave-server');
  let state = await snapshot(host), record = state.memberHistory.find(item => item.name === 'Visitor');
  assert.equal(record.online, true); assert.equal(record.inServer, false); assert.equal(record.socketId, null);
  assert.equal(state.users.length, 1); assert.equal(state.soundMembers.length, 1);
  assert.equal((await request(presence, 'create-channel', { name: 'Invalid' })).ok, false);
  assert.ok(!JSON.stringify(state).includes(key));
  const second = await client(); await request(second, 'app-presence', payload);
  presence.disconnect(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await snapshot(host)).memberHistory.find(item => item.name === 'Visitor').online, true);
  second.disconnect(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await snapshot(host)).memberHistory.find(item => item.name === 'Visitor').online, false);
});
test('presence rejects unknown identities and removed profiles and expires without heartbeats', async t => {
  const client = await setup(t, { presenceTtlMs: 120, presenceSweepMs: 20 });
  const host = await client(), user = await client(), presence = await client();
  const hostJoin = await join(host, 'Owner', identity(), '10.144.2.1'), key = identity();
  const serverId = hostJoin.serverId;
  assert.equal((await request(presence, 'app-presence', { serverId, identity: key })).ok, false);
  await join(user, 'Visitor', key, '10.144.2.2'); await request(user, 'leave-server');
  assert.equal((await request(presence, 'app-presence', { serverId: 'wrong', identity: key })).ok, false);
  const payload = { serverId, identity: key };
  await request(presence, 'app-presence', payload);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal((await snapshot(host)).memberHistory.find(item => item.name === 'Visitor').online, false);
  await request(presence, 'app-presence', payload);
  const member = (await snapshot(host)).memberHistory.find(item => item.name === 'Visitor');
  assert.equal(member.online, true);
  const revoked = new Promise(resolve => presence.once('app-presence-revoked', resolve));
  assert.equal((await request(host, 'delete-member-config', { memberId: member.memberId })).ok, true);
  await revoked;
  assert.equal((await request(presence, 'app-presence', payload)).ok, false);
  assert.equal((await snapshot(host)).memberHistory.length, 1);
});
