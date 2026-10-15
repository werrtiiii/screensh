const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const snapshot = (channel = 'main', others = []) => ({ serverId: 'server', users: [{ socketId: 'self', channelId: channel }, ...others] });
test('own join, channel switch and leave play distinct cues only once', async () => {
  const { ChannelSoundTracker } = await import('./renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker();
  assert.deepEqual(tracker.update(snapshot(), 'self').sounds, ['enter_voice']);
  assert.deepEqual(tracker.update(snapshot(), 'self').sounds, []);
  assert.deepEqual(tracker.update(snapshot('other'), 'self').sounds, ['exit_voice', 'enter_voice']);
  assert.deepEqual(tracker.leave().sounds, ['exit_voice']); assert.deepEqual(tracker.leave().sounds, []);
});
test('other members entering and leaving are scoped to current channel and coalesced', async () => {
  const { ChannelSoundTracker } = await import('./renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker(); tracker.update(snapshot(), 'self');
  const members = [{ socketId: 'a', channelId: 'main' }, { socketId: 'b', channelId: 'main' }];
  assert.deepEqual(tracker.update(snapshot('main', members), 'self').sounds, ['person_enter_voice']);
  assert.deepEqual(tracker.update(snapshot('main', members.map(u => ({ ...u, voiceMuted: true, avatar: 'changed' }))), 'self').sounds, []);
  assert.deepEqual(tracker.update(snapshot('main', members.map(u => ({ ...u, channelId: 'elsewhere' }))), 'self').sounds, ['person_exit_voice']);
  assert.deepEqual(tracker.update(snapshot('main', [{ socketId: 'c', channelId: 'elsewhere' }]), 'self').sounds, []);
});
test('joining an occupied channel and reconnecting do not replay a cue for every occupant', async () => {
  const { ChannelSoundTracker } = await import('./renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker();
  const joined = snapshot('main', [{ socketId: 'a', channelId: 'main' }]);
  assert.deepEqual(tracker.update(joined, 'self').sounds, ['enter_voice']);
  const restored = { ...joined, users: joined.users.map(u => u.socketId === 'self' ? { ...u, socketId: 'new-self' } : u) };
  assert.deepEqual(tracker.update(restored, 'new-self', { silent: true }).sounds, []);
  assert.deepEqual(tracker.update(restored, 'new-self').sounds, []);
  assert.deepEqual(new ChannelSoundTracker().leave().sounds, []);
});
test('all four selected channel cues are valid bundled WAV files', () => {
  for (const name of ['enter_voice', 'exit_voice', 'person_enter_voice', 'person_exit_voice']) {
    const data = fs.readFileSync(path.join(__dirname, 'renderer/assets/sounds', name + '.wav'));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF'); assert.equal(data.subarray(8, 12).toString(), 'WAVE');
    assert.ok(data.length > 44);
  }
});
