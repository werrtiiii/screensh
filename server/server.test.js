const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { io: connect } = require('socket.io-client');
const { createSignalingServer } = require('./server');
const identity = () => randomBytes(32).toString('hex');

test('short network disconnect suppresses channel cues and restores original channel with stable public presence', async t => {
  const { ChannelSoundTracker } = await import('../app/renderer/channel-sound-tracker.mjs');
  const f = await fixture(t, { disconnectGraceMs: 800 }), host = await f.client(), member = await f.client();
  await request(host, 'join-server', { userName: 'Observer', virtualIp: '10.144.7.1', identity: identity() });
  const key = identity();
  await request(member, 'join-server', { userName: 'Reconnect', virtualIp: '10.144.7.2', identity: key });
  const channel = (await request(host, 'create-channel', { name: 'Restore' })).channel;
  await request(member, 'switch-channel', { channelId: channel.id });
  const before = await request(host, 'switch-channel', { channelId: channel.id });
  const tracker = new ChannelSoundTracker(); tracker.update(before, host.id);
  const original = before.users.find(u => u.socketId === member.id);
  const dropped = new Promise(resolve => host.once('server-update', resolve));
  member.io.engine.close();
  const missing = await dropped;
  assert.equal(missing.users.length, 1, 'disconnected member disappears from actual membership immediately');
  assert.deepEqual(tracker.update(missing, host.id).sounds, []);
  const returning = await f.client();
  const restored = await request(returning, 'join-server', { userName: 'Reconnect', virtualIp: '10.144.7.2', identity: key });
  const user = restored.users.find(u => u.socketId === returning.id);
  assert.equal(user.channelId, channel.id); assert.equal(user.memberId, original.memberId); assert.notEqual(user.socketId, original.socketId);
  assert.equal(user.voiceEnabled, false); assert.equal(user.isSharing, false);
  assert.deepEqual(tracker.update(restored, host.id).sounds, []);
  const left = new Promise(resolve => host.once('server-update', resolve));
  await request(returning, 'leave-server');
  assert.deepEqual(tracker.update(await left, host.id).sounds, ['person_exit_voice']);
});

test('lost member emits one exit after grace; intentional disconnect and channel switch remain immediate', async t => {
  const { ChannelSoundTracker } = await import('../app/renderer/channel-sound-tracker.mjs');
  const f = await fixture(t, { disconnectGraceMs: 150 }), host = await f.client(), peer = await f.client();
  await request(host, 'join-server', { userName: 'Observer', virtualIp: '10.144.7.1', identity: identity() });
  const payload = { userName: 'Peer', virtualIp: '10.144.7.2', identity: identity() };
  const joined = await request(peer, 'join-server', payload);
  const originalMemberId = joined.users.find(u => u.socketId === peer.id).memberId;
  const tracker = new ChannelSoundTracker(); tracker.update(joined, host.id);
  const dropped = new Promise(resolve => host.once('server-update', resolve)); peer.io.engine.close();
  assert.deepEqual(tracker.update(await dropped, host.id).sounds, []);
  const expired = await new Promise(resolve => host.once('server-update', resolve));
  assert.deepEqual(tracker.update(expired, host.id).sounds, ['person_exit_voice']);
  const again = await f.client(); const rejoined = await request(again, 'join-server', payload);
  assert.notEqual(rejoined.users.find(u => u.socketId === again.id).memberId, originalMemberId);
  assert.deepEqual(tracker.update(rejoined, host.id).sounds, ['person_enter_voice']);
  const channel = (await request(host, 'create-channel', { name: 'Elsewhere' })).channel;
  const switched = await request(again, 'switch-channel', { channelId: channel.id });
  assert.deepEqual(tracker.update(switched, host.id).sounds, ['person_exit_voice']);
  tracker.update(await request(again, 'switch-channel', { channelId: 'main' }), host.id);
  const left = new Promise(resolve => host.once('server-update', resolve)); again.disconnect();
  assert.deepEqual(tracker.update(await left, host.id).sounds, ['person_exit_voice']);
  const kicked = await f.client(); tracker.update(await request(kicked, 'join-server', payload), host.id);
  const removed = new Promise(resolve => host.once('server-update', resolve));
  await request(host, 'kick-member', { socketId: kicked.id });
  assert.deepEqual(tracker.update(await removed, host.id).sounds, ['person_exit_voice']);
});

test('server name defaults and persists, only owner can rename, and deafen is independent of voice enablement', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-name-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const f = await fixture(t, { stateFile }), host = await f.client(), admin = await f.client(), outsider = await f.client();
  const hostIdentity = identity();
  const joined = await request(host, 'join-server', { userName: 'Host', virtualIp: '10.144.6.1', identity: hostIdentity, voiceDeafened: true });
  assert.equal(joined.serverName, '0091 Server'); assert.equal(joined.users[0].voiceDeafened, true);
  await request(admin, 'join-server', { userName: 'Admin', virtualIp: '10.144.6.2', identity: identity() });
  assert.equal((await request(admin, 'set-server-name', { name: 'Denied' })).ok, false);
  await request(host, 'set-admin', { socketId: admin.id, enabled: true });
  assert.equal((await request(admin, 'set-server-name', { name: 'Denied' })).ok, false);
  assert.equal((await request(outsider, 'set-server-name', { name: 'Denied' })).ok, false);
  for (const name of ['', '   ', 'x'.repeat(41), 'bad\nname', 123]) assert.equal((await request(host, 'set-server-name', { name })).ok, false);
  const changed = new Promise(resolve => admin.once('server-update', resolve));
  assert.equal((await request(host, 'set-server-name', { name: '  我的服务器  ' })).serverName, '我的服务器');
  assert.equal((await changed).serverName, '我的服务器');
  assert.equal((await request(host, 'set-voice-state', { enabled: false, deafened: 'yes' })).ok, false);
  await request(host, 'set-voice-state', { enabled: false, deafened: false });
  let snapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(snapshot.users.find(u => u.socketId === host.id).voiceDeafened, false);
  await request(host, 'set-voice-state', { enabled: false, deafened: true });
  snapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(snapshot.users.find(u => u.socketId === host.id).voiceDeafened, true);
  await f.close();
  const g = await fixture(t, { stateFile }), client = await g.client();
  assert.equal((await request(client, 'server-info')).serverName, '我的服务器');
  // Existing state files without a name are migrated without losing ownership.
  await g.close(); const saved = JSON.parse(fs.readFileSync(stateFile)); delete saved.serverName; fs.writeFileSync(stateFile, JSON.stringify(saved));
  const h = await fixture(t, { stateFile }), returning = await h.client();
  const restored = await request(returning, 'join-server', { userName: 'Host', virtualIp: '10.144.6.1', identity: hostIdentity });
  assert.equal(restored.serverName, '0091 Server'); assert.equal(restored.users[0].role, 'host');
});

test('interactions validate membership, target, channel and enforce a shared one-second cooldown', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client(), c = await f.client(), outsider = await f.client();
  const key = identity();
  for (const [i, client] of [a, b, c].entries()) assert.equal((await request(client, 'join-server', { userName: 'Interact' + i, virtualIp: '10.144.5.' + (i + 1), identity: i === 0 ? key : identity() })).ok, true);
  const channel = (await request(a, 'create-channel', { name: 'Other' })).channel;
  await request(c, 'switch-channel', { channelId: channel.id });
  let outsideEvents = 0; c.on('interaction', () => outsideEvents++); outsider.on('interaction', () => outsideEvents++);
  assert.equal((await request(outsider, 'interact', { target: b.id, sticker: 'bomb' })).ok, false);
  for (const payload of [{ target: a.id, sticker: 'bomb' }, { target: 'missing', sticker: 'bomb' }, { target: c.id, sticker: 'bomb' }, { target: b.id, sticker: '../file' }]) assert.equal((await request(a, 'interact', payload)).ok, false);
  const sent = new Promise(resolve => a.once('interaction', resolve)), received = new Promise(resolve => b.once('interaction', resolve));
  assert.equal((await request(a, 'interact', { target: b.id, sticker: 'bomb' })).ok, true);
  const event = await sent; assert.deepEqual(await received, event);
  assert.equal(event.from, a.id); assert.equal(event.target, b.id); assert.equal(event.sticker, 'bomb'); assert.equal(event.channelId, 'main');
  assert.equal((await request(a, 'interact', { target: b.id, sticker: 'heart' })).ok, false);
  const returning = await f.client();
  assert.equal((await request(returning, 'join-server', { userName: 'Interact0', virtualIp: '10.144.5.1', identity: key })).ok, true);
  assert.equal((await request(returning, 'interact', { target: b.id, sticker: 'heart' })).ok, false, 'reconnect must not reset cooldown');
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal((await request(returning, 'interact', { target: b.id, sticker: 'heart' })).ok, true);
  assert.equal(outsideEvents, 0);
});
test('2 MiB avatar and server icon survive upload and retrieval; larger images are rejected', async t => {
  const f = await fixture(t), host = await f.client();
  const image = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024, 1).toString('base64');
  const join = await request(host, 'join-server', { userName: 'Large image', virtualIp: '10.144.1.1', identity: identity(), avatar: image });
  assert.equal(join.ok, true);
  assert.equal((await request(host, 'get-image', { ref: join.users[0].avatar })).data, image);
  const icon = await request(host, 'set-server-icon', { icon: image }); assert.equal(icon.ok, true);
  assert.equal((await request(host, 'get-image', { ref: icon.serverIcon })).data, image);
  const oversized = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString('base64');
  assert.equal((await request(host, 'set-avatar', { avatar: oversized })).ok, false);
  assert.equal((await request(host, 'set-server-icon', { icon: oversized })).ok, false);
  assert.equal(host.connected, true);
});
test('voice isolation, mute hierarchy and channel cleanup', async t => {
  const f = await fixture(t), host = await f.client(), admin = await f.client(), member = await f.client(), outsider = await f.client();
  for (const [i, client] of [host, admin, member].entries()) assert.equal((await request(client, 'join-server', { userName: 'Voice' + i, virtualIp: '10.144.2.' + (i + 1), identity: identity() })).ok, true);
  await request(host, 'set-admin', { socketId: admin.id, enabled: true });
  assert.equal((await request(outsider, 'set-voice-state', { enabled: true })).ok, false);
  assert.equal((await request(host, 'set-voice-state', { enabled: 'yes' })).ok, false);
  for (const client of [host, admin, member]) await request(client, 'set-voice-state', { enabled: true });
  assert.equal((await request(outsider, 'voice-activity', { speaking: true })).ok, false);
  assert.equal((await request(host, 'voice-activity', { speaking: 'yes' })).ok, false);
  const activity = new Promise(resolve => member.once('voice-activity', resolve));
  await request(host, 'voice-activity', { speaking: true });
  assert.deepEqual(await activity, { from: host.id, speaking: true });
  let speakingSnapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(speakingSnapshot.users.find(u => u.socketId === host.id).voiceSpeaking, true);
  assert.equal((await request(host, 'set-voice-state', { enabled: true, muted: 'yes' })).ok, false);
  await request(host, 'set-voice-state', { enabled: true, muted: true });
  speakingSnapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(speakingSnapshot.users.find(u => u.socketId === host.id).microphoneMuted, true);
  assert.equal(speakingSnapshot.users.find(u => u.socketId === host.id).voiceSpeaking, false);
  assert.equal((await request(host, 'set-voice-state', { enabled: true, accompaniment: 'yes' })).ok, false);
  await request(host, 'set-voice-state', { enabled: true, muted: true, accompaniment: true });
  await request(host, 'voice-activity', { speaking: true });
  speakingSnapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(speakingSnapshot.users.find(u => u.socketId === host.id).voiceSpeaking, true);
  await request(host, 'set-voice-state', { enabled: true, muted: true, accompaniment: false });
  speakingSnapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(speakingSnapshot.users.find(u => u.socketId === host.id).voiceSpeaking, false);
  await request(host, 'set-voice-state', { enabled: true, muted: false });
  assert.equal((await request(member, 'set-member-mute', { socketId: host.id, muted: true })).ok, false);
  assert.equal((await request(admin, 'set-member-mute', { socketId: host.id, muted: true })).ok, false);
  assert.equal((await request(admin, 'set-member-mute', { socketId: member.id, muted: true })).ok, true);
  await request(member, 'voice-activity', { speaking: true });
  speakingSnapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(speakingSnapshot.users.find(u => u.socketId === member.id).voiceSpeaking, false);
  await request(member, 'set-voice-state', { enabled: false }); await request(member, 'set-voice-state', { enabled: true });
  let snapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(snapshot.users.find(u => u.socketId === member.id).voiceMuted, true);
  const received = new Promise(resolve => member.once('voice-signal', resolve));
  assert.equal((await request(host, 'voice-signal', { to: member.id, data: { candidate: {} } })).ok, true);
  assert.equal((await received).from, host.id);
  const channel = (await request(host, 'create-channel', { name: 'Private' })).channel;
  snapshot = await request(member, 'switch-channel', { channelId: channel.id });
  assert.equal(snapshot.users.find(u => u.socketId === member.id).voiceEnabled, false);
  let leakedActivity = false; member.once('voice-activity', () => { leakedActivity = true; });
  await request(host, 'voice-activity', { speaking: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(leakedActivity, false, 'Speaking events must not cross channels');
  await request(member, 'set-voice-state', { enabled: true });
  assert.equal((await request(host, 'voice-signal', { to: member.id, data: {} })).ok, false);
  assert.equal((await request(admin, 'set-member-mute', { socketId: member.id, muted: false })).ok, false);
  await request(host, 'delete-channel', { channelId: channel.id });
  snapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(snapshot.users.find(u => u.socketId === member.id).voiceEnabled, false);
  assert.equal((await request(host, 'set-member-mute', { socketId: member.id, muted: false })).ok, true);
});
const request = async (s, event, payload = {}) => {
  if (event === 'join-server' && !Object.hasOwn(payload, 'easytierPeers')) {
    const access = await request(s, 'check-access', payload);
    payload = { ...payload, easytierPeers: access.easytierPeers };
  }
  return new Promise((resolve, reject) => {
  s.timeout(2000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response));
  });
};
async function fixture(t, options) {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [], url = 'http://127.0.0.1:' + server.address().port;
  const close = async () => { clients.forEach(s => s.disconnect()); await new Promise(resolve => io.close(resolve)); };
  t.after(close);
  return { url, close, async client(extraHeaders) {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, extraHeaders });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  } };
}
test('invalid first join cannot reserve owner; avatars use cached identifiers and immutable files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-images-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const f = await fixture(t, { stateFile }), bad = await f.client(), good = await f.client(), outsider = await f.client();
  assert.equal((await request(bad, 'join-server', { userName: 'Bad', virtualIp: '10.144.1.1', identity: identity(), avatar: 'invalid' })).ok, false);
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).owner, null);
  const avatar = 'data:image/png;base64,' + Buffer.alloc(90000, 1).toString('base64');
  const joined = await request(good, 'join-server', { userName: 'Good', virtualIp: '10.144.1.2', identity: identity(), avatar });
  assert.equal(joined.users[0].role, 'host');
  const ref = joined.users[0].avatar;
  assert.match(ref, /^image:[a-f0-9]{64}\.png$/);
  assert.ok(Buffer.byteLength(JSON.stringify(joined)) < 2000);
  assert.equal((await request(outsider, 'get-image', { ref })).ok, false);
  assert.equal((await request(good, 'get-image', { ref })).data, avatar);
  const file = path.join(dir, 'media', ref.slice(6));
  fs.utimesSync(file, 1000, 1000);
  await request(good, 'create-channel', { name: 'No image rewrite' });
  assert.equal(fs.statSync(file).mtimeMs, 1000000);
  assert.equal((await request(good, 'set-avatar', { avatar })).avatar, ref);
  assert.equal(fs.statSync(file).mtimeMs, 1000000);
  const stored = JSON.parse(fs.readFileSync(stateFile));
  assert.equal(Object.values(stored.userProfiles)[0].avatar, 'media/' + ref.slice(6));
  await f.close();
  const g = await fixture(t, { stateFile }), next = await g.client();
  await request(next, 'join-server', { userName: 'Next', virtualIp: '10.144.1.3', identity: identity() });
  assert.equal(fs.statSync(file).mtimeMs, 1000000);
});

test('password limits separate trusted forwarded clients and reject untrusted spoofing', async t => {
  for (const trustedProxies of ['loopback', false]) {
    const f = await fixture(t, { trustedProxies }), host = await f.client();
    await request(host, 'join-server', { userName: 'Host', virtualIp: '10.144.1.1', identity: identity() });
    await request(host, 'set-server-password', { enabled: true, password: 'correct' });
    const bad = await f.client({ 'X-Forwarded-For': '203.0.113.1' });
    for (let i = 0; i < 20; i++) await request(bad, 'check-access', { userName: 'Bad', password: 'wrong' });
    const good = await f.client({ 'X-Forwarded-For': '203.0.113.2' });
    const result = await request(good, 'check-access', { userName: 'Good', password: 'correct' });
    assert.equal(result.ok, trustedProxies !== false);
    if (!result.ok) assert.match(result.message, /频繁/);
    await f.close();
  }
});

test('avatar and icon reset persist; explicit null on rejoin removes previous avatar', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-reset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const f = await fixture(t, { stateFile }), host = await f.client(), member = await f.client();
  const owner = identity(), avatar = 'data:image/png;base64,AQID';
  const join = { userName: 'Host', virtualIp: '10.144.1.1', identity: owner, avatar };
  await request(host, 'join-server', join);
  await request(member, 'join-server', { userName: 'Member', virtualIp: '10.144.1.2', identity: identity() });
  await request(host, 'set-server-icon', { icon: avatar });
  assert.equal((await request(member, 'set-server-icon', { icon: null })).ok, false);
  assert.equal((await request(host, 'set-server-icon', { icon: null })).serverIcon, null);
  assert.equal((await request(host, 'set-avatar', { avatar: null })).avatar, null);
  let snapshot = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(snapshot.serverIcon, null); assert.equal(snapshot.users.find(u => u.socketId === host.id).avatar, null);
  await request(host, 'set-avatar', { avatar });
  await request(host, 'leave-server');
  snapshot = await request(host, 'join-server', { ...join, avatar: null });
  assert.equal(snapshot.users.find(u => u.socketId === host.id).avatar, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile)).userProfiles, {});
  await f.close();
  const g = await fixture(t, { stateFile }), returning = await g.client();
  const restored = await request(returning, 'join-server', { ...join, avatar: null });
  assert.equal(restored.serverIcon, null); assert.equal(restored.users[0].avatar, null);
});

test('new server requires deployment peers', () => {
  assert.throws(() => createSignalingServer({ initialPeers: '' }), /SCREENSH_EASYTIER_PEERS/);
});
test('deployment peers initialize state and saved room settings take precedence', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-peers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const first = await fixture(t, { stateFile, initialPeers: 'peer.example:11010\nudp://other.example:11011' });
  const owner = await first.client();
  assert.deepEqual((await request(owner, 'check-access', { userName: 'Owner' })).easytierPeers,
    ['tcp://peer.example:11010', 'udp://other.example:11011']);
  assert.equal((await request(owner, 'join-server', { userName: 'Owner', virtualIp: '10.144.1.1', identity: identity() })).ok, true);
  assert.equal((await request(owner, 'set-server-peers', { peers: ['changed.example:11012'] })).ok, true);
  await first.close();
  const second = await fixture(t, { stateFile, initialPeers: '' });
  const visitor = await second.client();
  assert.deepEqual((await request(visitor, 'check-access', { userName: 'Visitor' })).easytierPeers,
    ['tcp://changed.example:11012']);
});
test('single server: required names, role enforcement, channels and isolation', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client(), c = await f.client(), outsider = await f.client();
  const info = await request(a, 'server-info');
  assert.equal(info.protocol, 2);
  for (const userName of ['', '  ', {}, 'a'.repeat(21)]) {
    assert.equal((await request(a, 'join-server', { userName, virtualIp: '10.144.1.1', identity: identity() })).ok, false);
  }
  const owner = identity(), admin = identity();
  const joined = await request(a, 'join-server', { userName: 'A', virtualIp: '10.144.1.1', identity: owner });
  assert.equal(joined.users[0].role, 'host');
  assert.deepEqual(joined.channels, [{ id: 'main', name: '主频道' }]);
  assert.equal((await request(b, 'join-server', { userName: 'B', virtualIp: '10.144.1.1', identity: admin })).ok, false);
  await request(b, 'join-server', { userName: 'B', virtualIp: '10.144.1.2', identity: admin });
  assert.equal((await request(c, 'join-server', { userName: ' a ', virtualIp: '10.144.1.3', identity: identity() })).ok, false);
  await request(c, 'join-server', { userName: 'C', virtualIp: '10.144.1.3', identity: identity() });
  assert.equal((await request(outsider, 'create-channel', { name: 'bad' })).ok, false);
  assert.equal((await request(b, 'create-channel', { name: 'bad' })).ok, false);
  assert.equal((await request(b, 'set-admin', { socketId: c.id, enabled: true })).ok, false);
  assert.equal((await request(a, 'set-admin', { socketId: a.id, enabled: false })).ok, false);
  assert.equal((await request(a, 'set-admin', { socketId: b.id, enabled: true })).ok, true);
  const created = await request(b, 'create-channel', { name: '游戏频道' });
  assert.equal(created.ok, true);
  assert.equal((await request(a, 'create-channel', { name: '游戏频道' })).ok, false);
  await request(b, 'start-sharing');
  const switched = await request(b, 'switch-channel', { channelId: created.channel.id });
  assert.equal(switched.users.find(u => u.socketId === b.id).isSharing, false);
  assert.equal((await request(a, 'signal', { to: b.id, data: {} })).ok, false);
  assert.equal((await request(a, 'signal', { to: c.id, data: {} })).ok, true);
  assert.equal((await request(c, 'switch-channel', { channelId: 'missing' })).ok, false);
  assert.equal((await request(a, 'set-admin', { socketId: b.id, enabled: false })).ok, true);
  assert.equal((await request(b, 'create-channel', { name: 'denied' })).ok, false);
  await request(a, 'leave-server');
  assert.equal((await request(c, 'create-channel', { name: 'not-owner' })).ok, false);
  const restored = await request(a, 'join-server', { userName: 'Renamed', virtualIp: '10.144.1.1', identity: owner });
  assert.equal(restored.users.find(u => u.socketId === a.id).role, 'host');
  assert.equal(restored.channels.length, 2);
  const health = await (await fetch(f.url + '/health')).json();
  assert.equal(health.rooms, 1); assert.equal(health.channels, 2);
  assert.equal(JSON.stringify(restored).includes(owner), false, 'Never broadcast credentials');
});
test('password is owner-only, persisted as a hash, enforced on joins and removable', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-password-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const f = await fixture(t, { stateFile }), a = await f.client(), b = await f.client(), c = await f.client();
  const owner = identity();
  await request(a, 'join-server', { userName: 'Owner', virtualIp: '10.144.1.1', identity: owner });
  await request(b, 'join-server', { userName: 'Admin', virtualIp: '10.144.1.2', identity: identity() });
  await request(a, 'set-admin', { socketId: b.id, enabled: true });
  const setting = { enabled: true, password: 'secret-test-123' };
  assert.equal((await request(b, 'set-server-password', setting)).ok, false);
  assert.equal((await request(c, 'set-server-password', setting)).ok, false);
  assert.equal((await request(a, 'set-server-password', setting)).ok, true);
  assert.equal((await request(c, 'server-info')).passwordRequired, true);
  assert.equal((await request(b, 'create-channel', { name: 'Still online' })).ok, true);
  const payload = { userName: 'Guest', virtualIp: '10.144.1.3', identity: identity() };
  for (const password of [undefined, 'wrong']) {
    assert.equal((await request(c, 'check-access', { ...payload, password })).ok, false);
    assert.equal((await request(c, 'join-server', { ...payload, password })).ok, false);
  }
  assert.equal((await request(c, 'check-access', { ...payload, password: setting.password })).ok, true);
  const joined = await request(c, 'join-server', { ...payload, password: setting.password });
  assert.equal(joined.ok, true);
  assert.equal(JSON.stringify(joined).includes('hash'), false);
  const disk = fs.readFileSync(stateFile, 'utf8');
  assert.equal(disk.includes(setting.password), false);
  assert.equal(JSON.parse(disk).password.hash.length, 64);
  await f.close();
  const g = await fixture(t, { stateFile }), returning = await g.client();
  assert.equal((await request(returning, 'server-info')).passwordRequired, true);
  assert.equal((await request(returning, 'join-server', { userName: 'Owner', virtualIp: '10.144.1.1', identity: owner, password: setting.password })).ok, true);
  assert.equal((await request(returning, 'set-server-password', { enabled: true, password: 'replacement' })).ok, true);
  const guest = await g.client();
  assert.equal((await request(guest, 'join-server', { ...payload, password: setting.password })).ok, false);
  assert.equal((await request(returning, 'set-server-password', { enabled: false })).ok, true);
  assert.equal((await request(guest, 'join-server', payload)).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).password, null);
});

test('names are unique across channels and concurrent joins; released on leaving', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client();
  const pa = { userName: 'Alice', virtualIp: '10.144.1.1', identity: identity() };
  const pb = { userName: 'ＡLICE', virtualIp: '10.144.1.2', identity: identity() };
  const results = await Promise.all([request(a, 'join-server', pa), request(b, 'join-server', pb)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  const winner = results[0].ok ? a : b, loser = winner === a ? b : a;
  const channel = await request(winner, 'create-channel', { name: 'Other' });
  await request(winner, 'switch-channel', { channelId: channel.channel.id });
  assert.equal((await request(loser, 'check-access', { userName: ' alice ' })).ok, false);
  await request(winner, 'leave-server');
  assert.equal((await request(loser, 'join-server', loser === a ? pa : pb)).ok, true);
});

test('channel deletion moves members home and kick enforces strict role hierarchy', async t => {
  const f = await fixture(t), host = await f.client(), admin = await f.client(), member = await f.client(), otherAdmin = await f.client();
  for (const [i, client] of [host, admin, member, otherAdmin].entries()) {
    await request(client, 'join-server', { userName: 'User' + i, virtualIp: '10.144.1.' + (i + 1), identity: identity() });
  }
  for (const client of [admin, otherAdmin]) await request(host, 'set-admin', { socketId: client.id, enabled: true });
  const created = await request(admin, 'create-channel', { name: 'Temporary' });
  const channelId = created.channel.id;
  await request(member, 'switch-channel', { channelId }); await request(member, 'start-sharing');
  assert.equal((await request(member, 'delete-channel', { channelId })).ok, false);
  assert.equal((await request(host, 'delete-channel', { channelId: 'main' })).ok, false);
  const moved = new Promise(resolve => member.once('channel-deleted', resolve));
  assert.equal((await request(admin, 'delete-channel', { channelId })).ok, true); await moved;
  const state = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(state.users.find(u => u.socketId === member.id).channelId, 'main');
  assert.equal(state.users.find(u => u.socketId === member.id).isSharing, false);
  for (const [actor, target] of [[member, host], [admin, host], [admin, otherAdmin], [host, host]]) {
    assert.equal((await request(actor, 'kick-member', { socketId: target.id })).ok, false);
  }
  const kicked = new Promise(resolve => member.once('kicked', resolve));
  assert.equal((await request(admin, 'kick-member', { socketId: member.id })).ok, true); await kicked;
  const adminKicked = new Promise(resolve => admin.once('kicked', resolve));
  assert.equal((await request(host, 'kick-member', { socketId: admin.id })).ok, true); await adminKicked;
  const remaining = await request(host, 'switch-channel', { channelId: 'main' });
  assert.equal(remaining.users.length, 2);
});

test('server peers are owner-controlled, validated, persisted and checked at join', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-peers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const f = await fixture(t, { stateFile }), host = await f.client(), member = await f.client(), outsider = await f.client();
  await request(host, 'join-server', { userName: 'Host', virtualIp: '10.144.1.1', identity: identity() });
  await request(member, 'join-server', { userName: 'Member', virtualIp: '10.144.1.2', identity: identity() });
  const previous = (await request(outsider, 'check-access', { userName: 'New' })).easytierPeers;
  const peers = ['tcp://example.com:11010', 'udp://[::1]:11011'];
  assert.equal((await request(outsider, 'set-server-peers', { peers })).ok, false);
  assert.equal((await request(member, 'set-server-peers', { peers })).ok, false);
  await request(host, 'set-admin', { socketId: member.id, enabled: true });
  assert.equal((await request(member, 'set-server-peers', { peers })).ok, false);
  for (const peers of [[], ['https://example.com:443'], ['host:0'], 'host:123\n'.repeat(33)]) {
    assert.equal((await request(host, 'set-server-peers', { peers })).ok, false);
  }
  assert.deepEqual((await request(host, 'set-server-peers', { peers: ['example.com:11010', ...peers] })).easytierPeers, peers);
  assert.equal(member.connected, true);
  const payload = { userName: 'New', virtualIp: '10.144.1.3', identity: identity(), easytierPeers: previous };
  assert.equal((await request(outsider, 'join-server', payload)).ok, false);
  assert.equal((await request(outsider, 'join-server', { ...payload, easytierPeers: peers })).ok, true);
  await f.close();
  const g = await fixture(t, { stateFile }), next = await g.client();
  assert.deepEqual((await request(next, 'check-access', { userName: 'New' })).easytierPeers, peers);
});

test('viewer presence is scoped to active sharing and cleaned on channel changes and disconnect', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client(), c = await f.client();
  for (const [i, client] of [a, b, c].entries()) await request(client, 'join-server', { userName: 'Viewer' + i, virtualIp: '10.144.1.' + (i + 1), identity: identity() });
  const view = () => request(a, 'switch-channel', { channelId: 'main' });
  assert.equal((await request(b, 'request-view', { target: a.id })).ok, false);
  await request(a, 'start-sharing');
  assert.equal((await request(a, 'request-view', { target: a.id })).ok, false);
  await request(b, 'request-view', { target: a.id }); await request(c, 'request-view', { target: a.id });
  assert.equal((await view()).users.filter(u => u.watchingId === a.id).length, 2);
  await request(b, 'stop-viewing', { target: a.id });
  assert.equal((await view()).users.filter(u => u.watchingId === a.id).length, 1);
  const channelId = (await request(a, 'create-channel', { name: 'Elsewhere' })).channel.id;
  await request(c, 'switch-channel', { channelId });
  assert.equal((await view()).users.filter(u => u.watchingId === a.id).length, 0);
  assert.equal((await request(c, 'request-view', { target: a.id })).ok, false);
  await request(b, 'request-view', { target: a.id }); await request(a, 'stop-sharing');
  assert.equal((await view()).users.filter(u => u.watchingId).length, 0);
  await request(a, 'start-sharing'); await request(b, 'request-view', { target: a.id });
  await request(a, 'kick-member', { socketId: b.id });
  assert.equal((await view()).users.filter(u => u.watchingId).length, 0);
});

test('owner, administrators, server network ID and channels survive restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screensh-channels-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'server-state.json');
  const f = await fixture(t, { stateFile }), a = await f.client(), b = await f.client();
  const owner = identity(), admin = identity();
  const first = await request(a, 'join-server', { userName: 'Owner', virtualIp: '10.144.1.1', identity: owner });
  await request(b, 'join-server', { userName: 'Admin', virtualIp: '10.144.1.2', identity: admin });
  await request(a, 'set-admin', { socketId: b.id, enabled: true });
  await request(a, 'create-channel', { name: '持久频道' });
  await f.close();
  const g = await fixture(t, { stateFile }), newcomer = await g.client();
  const after = await request(newcomer, 'join-server', { userName: 'Owner', virtualIp: '10.144.1.3', identity: identity() });
  assert.equal(after.serverId, first.serverId); assert.equal(after.channels.length, 2);
  assert.equal(after.users[0].role, 'member', 'Same name must not grant ownership');
  const returning = await g.client();
  const restored = await request(returning, 'join-server', { userName: 'Admin', virtualIp: '10.144.1.2', identity: admin });
  assert.equal(restored.users.find(u => u.socketId === returning.id).role, 'admin');
  assert.equal(fs.readFileSync(stateFile, 'utf8').includes(admin), false);
});

test('same identity reconnects by reclaiming the stale socket and keeps the channel', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client();
  const key = identity();
  await request(a, 'join-server', { userName: 'Alice', virtualIp: '10.144.1.1', identity: key });
  await request(b, 'join-server', { userName: 'Bob', virtualIp: '10.144.1.2', identity: identity() });
  const channel = (await request(a, 'create-channel', { name: '语音房' })).channel;
  await request(a, 'switch-channel', { channelId: channel.id });
  const disconnected = new Promise(resolve => a.once('disconnect', resolve));
  const returning = await f.client();
  const rejoined = await request(returning, 'join-server', { userName: 'Alice', virtualIp: '10.144.1.1', identity: key });
  assert.equal(rejoined.ok, true);
  assert.equal(rejoined.users.find(u => u.socketId === returning.id).channelId, channel.id);
  assert.equal(rejoined.users.find(u => u.socketId === returning.id).role, 'host');
  assert.equal(rejoined.users.length, 2);
  await disconnected;
  assert.equal(a.connected, false);
});
