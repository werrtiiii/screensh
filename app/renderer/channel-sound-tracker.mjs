export class ChannelSoundTracker {
  update(snapshot, selfId, { silent = false } = {}) {
    const me = snapshot.users.find(user => user.socketId === selfId);
    if (!me) return { sounds: [], replace: false };
    const current = { server: snapshot.serverId, channel: me.channelId,
      members: new Set(snapshot.users.filter(user => user.channelId === me.channelId && user.socketId !== selfId).map(user => user.socketId)) };
    const previous = this.current; this.current = current;
    if (silent) return { sounds: [], replace: true };
    if (!previous) return { sounds: ['enter_voice'], replace: true };
    if (previous.server !== current.server || previous.channel !== current.channel) return { sounds: ['exit_voice', 'enter_voice'], replace: true };
    const sounds = [];
    // One cue per event type in a snapshot avoids a burst when a group moves.
    if ([...previous.members].some(id => !current.members.has(id))) sounds.push('person_exit_voice');
    if ([...current.members].some(id => !previous.members.has(id))) sounds.push('person_enter_voice');
    return { sounds, replace: false };
  }
  leave() {
    const joined = !!this.current; this.current = null;
    return { sounds: joined ? ['exit_voice'] : [], replace: true };
  }
}
