const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createSignalingServer } = require('./server');

function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, done); reject(new Error(`timeout: ${name}`)); }, 2000);
    function done(value) { clearTimeout(timeout); resolve(value); }
    socket.once(name, done);
  });
}
test('room lifecycle, input validation and isolation', async t => {
  const { server, io } = createSignalingServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => io.close(resolve)); });
  async function client() {
    const s = connect(url, { transports: ['websocket'], reconnection: false });
    clients.push(s); await event(s, 'connect'); return s;
  }
  async function request(s, name, payload, response) {
    const pending = event(s, response); s.emit(name, payload); return pending;
  }
  const a = await client(), b = await client(), outsider = await client();
  for (const payload of [null, [], 42, {}, { roomId: 'x', userName: {}, virtualIp: '10.144.1.1' }, { roomId: 'x', virtualIp: '<script>' }]) {
    assert.ok((await request(a, 'join-room', payload, 'error')).message);
  }
  const room = { roomId: 'test', userName: 'A', virtualIp: '10.144.1.1' };
  const created = await request(a, 'create-room', room, 'room-created');
  assert.equal(created.users[0].virtualIp, room.virtualIp);
  assert.ok((await request(b, 'join-room', room, 'error')).message.includes('冲突'));
  const joined = await request(b, 'join-room', { ...room, userName: 'B', virtualIp: '10.144.1.2' }, 'room-joined');
  assert.equal(joined.users.length, 2);
  assert.equal(joined.users[0].virtualIp, room.virtualIp);
  assert.ok((await request(a, 'create-room', { ...room, roomId: 'ghost' }, 'error')).message);
  let notification = event(b, 'peer-sharing-started'); a.emit('start-sharing');
  assert.equal((await notification).socketId, a.id);
  notification = event(b, 'signal'); a.emit('signal', { to: b.id, data: { offer: true } });
  assert.equal((await notification).from, a.id);
  await request(outsider, 'create-room', { ...room, roomId: b.id, virtualIp: '10.144.1.3' }, 'room-created');
  // Application room names cannot impersonate Socket.IO's private socket rooms.
  for (const [name, field] of [['signal', 'to'], ['request-view', 'target'], ['stop-viewing', 'target']]) {
    assert.ok((await request(outsider, name, { [field]: b.id }, 'error')).message);
    assert.ok((await request(outsider, name, null, 'error')).message);
  }
  const updated = event(b, 'room-update'); a.disconnect();
  const remaining = (await updated).users;
  assert.equal(remaining.length, 1); assert.equal(remaining[0].role, 'host');
  b.emit('leave-room');
  const list = await request(b, 'list-rooms', undefined, 'rooms-list');
  assert.equal(list.length, 1); assert.equal(list[0].roomId, b.id);
  const health = await (await fetch(`${url}/health`)).json();
  assert.deepEqual(health, { status: 'ok', rooms: 1 });
});
