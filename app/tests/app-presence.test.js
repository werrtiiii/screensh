const { test } = require('node:test');
const assert = require('node:assert/strict');
const storageOf = entries => { const values = new Map(entries); return { get length() { return values.size; }, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
test('presence only contacts saved HTTP servers and retains server-specific identities', async () => {
  const { presenceTargets } = await import('../renderer/app-presence.mjs');
  const serverId = 'a'.repeat(36), identity = 'b'.repeat(64), url = 'http://localhost:3000';
  const storage = storageOf([['serverBookmarks', JSON.stringify([{ url }, { url: 'javascript:bad' }])], ['serverIdentity:' + url + ':' + serverId, identity], ['serverIdentity:https://removed.test:' + serverId, identity]]);
  assert.deepEqual(presenceTargets(storage), [{ url, serverId, identity }]);
});
test('background presence verifies instance ID, keeps one connection and stops on removal', async t => {
  const { AppPresence } = await import('../renderer/app-presence.mjs');
  const { EventEmitter } = require('node:events');
  const url = 'http://localhost:3000', serverId = 'a'.repeat(36), identity = 'b'.repeat(64);
  const storage = storageOf([['serverBookmarks', JSON.stringify([{ url }])], ['serverIdentity:' + url + ':' + serverId, identity]]);
  const sockets = [];
  const presence = new AppPresence({ storage, connect: (_url, options) => {
    const socket = new EventEmitter(); socket.sent = []; socket.connected = true;
    socket.timeout = () => ({ emit: (event, payload, ack) => { socket.sent.push([event, payload]); socket.ack = ack; } });
    socket.disconnect = () => { socket.connected = false; };
    assert.equal(options.forceNew, true); sockets.push(socket); return socket;
  } });
  t.after(() => presence.stop());
  presence.sync(); presence.sync(); assert.equal(sockets.length, 1);
  const socket = sockets[0]; socket.emit('connect');
  assert.deepEqual(socket.sent, [['server-info', {}]]);
  socket.ack(null, { ok: true, serverId, appPresence: true });
  assert.deepEqual(socket.sent[1], ['app-presence', { serverId, identity }]);
  socket.ack(null, { ok: true });
  socket.emit('disconnect'); assert.equal(presence.connections.get(url).identity, null);
  socket.connected = true; socket.emit('connect'); socket.ack(null, { ok: true, serverId: 'different', appPresence: true });
  assert.equal(socket.connected, false); assert.equal(socket.sent.length, 3, 'identity never sent to a different instance');
  storage.setItem('serverBookmarks', '[]'); presence.sync(); assert.equal(presence.connections.size, 0);
});
