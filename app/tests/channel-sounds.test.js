const { test } = require('node:test');
const assert = require('node:assert/strict');

test('remaining outside channels is silent and joining a channel restores entry cues', async()=>{
  const {ChannelSoundTracker}=await import('../renderer/channel-sound-tracker.mjs');
  const tracker=new ChannelSoundTracker();
  const outside={serverId:'server',users:[{socketId:'self',channelId:null},{socketId:'other',channelId:null}]};
  assert.deepEqual(tracker.update(outside,'self').sounds,[]);
  assert.deepEqual(tracker.update({...outside,users:[...outside.users,{socketId:'new',channelId:null}]},'self').sounds,[]);
  assert.deepEqual(tracker.update({...outside,users:[{socketId:'self',channelId:'main'}]},'self').sounds,['enter_voice']);
  assert.deepEqual(tracker.update(outside,'self'),{sounds:['exit_voice'],replace:true});
  assert.deepEqual(tracker.update(outside,'self'),{sounds:[],replace:false});
});
const fs = require('node:fs'), path = require('node:path');
const snapshot = (channel = 'main', others = []) => ({ serverId: 'server', users: [{ socketId: 'self', channelId: channel }, ...others] });
test('switching channels keeps the entry cue and leaving the server keeps the exit cue', async () => {
  const { ChannelSoundTracker } = await import('../renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker();
  assert.deepEqual(tracker.update(snapshot(), 'self').sounds, ['enter_voice']);
  assert.deepEqual(tracker.update(snapshot(), 'self').sounds, []);
  assert.deepEqual(tracker.update(snapshot('other'), 'self').sounds, ['enter_voice']);
  assert.deepEqual(tracker.update(snapshot('main'), 'self').sounds, ['enter_voice']);
  assert.deepEqual(tracker.leave().sounds, ['exit_voice']); assert.deepEqual(tracker.leave().sounds, []);
});

test('restoring outside a channel stays silent and a failed exit does not play an exit cue', async () => {
  const { ChannelSoundTracker } = await import('../renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker();
  tracker.update(snapshot(), 'self');
  // A rejected switch leaves the server snapshot unchanged.
  assert.deepEqual(tracker.update(snapshot(), 'self').sounds, []);
  assert.deepEqual(tracker.update(snapshot(null), 'self', { silent: true }).sounds, []);
  assert.deepEqual(tracker.update(snapshot(null), 'self').sounds, []);
  assert.deepEqual(tracker.update(snapshot(), 'self').sounds, ['enter_voice']);
  assert.deepEqual(tracker.update(snapshot(null), 'self').sounds, ['exit_voice']);
});
test('other members entering and leaving are scoped to current channel and coalesced', async () => {
  const { ChannelSoundTracker } = await import('../renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker(); tracker.update(snapshot(), 'self');
  const members = [{ socketId: 'a', channelId: 'main' }, { socketId: 'b', channelId: 'main' }];
  assert.deepEqual(tracker.update(snapshot('main', members), 'self').sounds, ['person_enter_voice']);
  assert.deepEqual(tracker.update(snapshot('main', members.map(u => ({ ...u, voiceMuted: true, avatar: 'changed' }))), 'self').sounds, []);
  assert.deepEqual(tracker.update(snapshot('main', members.map(u => ({ ...u, channelId: 'elsewhere' }))), 'self').sounds, ['person_exit_voice']);
  assert.deepEqual(tracker.update(snapshot('main', [{ socketId: 'c', channelId: 'elsewhere' }]), 'self').sounds, []);
});
test('joining an occupied channel and reconnecting do not replay a cue for every occupant', async () => {
  const { ChannelSoundTracker } = await import('../renderer/channel-sound-tracker.mjs');
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
    const data = fs.readFileSync(path.join(__dirname, "../renderer/assets/sounds", name + '.wav'));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF'); assert.equal(data.subarray(8, 12).toString(), 'WAVE');
    assert.ok(data.length > 44);
  }
});

test('stable sound presence suppresses short disconnect and socket replacement, but reports final departure', async () => {
  const { ChannelSoundTracker } = await import('../renderer/channel-sound-tracker.mjs');
  const tracker = new ChannelSoundTracker();
  const me = { socketId: 'self', memberId: 'me', channelId: 'main' };
  const other = { socketId: 'old', memberId: 'peer', channelId: 'main' };
  const soundMembers = [me, other].map(({ memberId, channelId }) => ({ memberId, channelId }));
  tracker.update({ serverId: 'server', users: [me, other], soundMembers }, 'self');
  assert.deepEqual(tracker.update({ serverId: 'server', users: [me], soundMembers }, 'self').sounds, []);
  assert.deepEqual(tracker.update({ serverId: 'server', users: [me, { ...other, socketId: 'new' }], soundMembers }, 'self').sounds, []);
  assert.deepEqual(tracker.update({ serverId: 'server', users: [me], soundMembers: soundMembers.slice(0, 1) }, 'self').sounds, ['person_exit_voice']);
  assert.deepEqual(tracker.update({ serverId: 'server', users: [me], soundMembers: soundMembers.slice(0, 1) }, 'self').sounds, []);
});
