const key = serverId => `serverChannelPreferences:${serverId}`;
export function readChannelPreferences(serverId) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(serverId)));
    return { autoJoin: saved?.autoJoin !== false, lastChannel: saved?.lastChannel === null || typeof saved?.lastChannel === 'string' ? saved.lastChannel : 'main' };
  } catch { return { autoJoin: true, lastChannel: 'main' }; }
}
export function saveChannelPreference(serverId, changes) {
  localStorage.setItem(key(serverId), JSON.stringify({ ...readChannelPreferences(serverId), ...changes }));
}
export function preferredChannel(serverId) {
  const saved = readChannelPreferences(serverId);
  return saved.autoJoin ? saved.lastChannel || 'main' : null;
}
export async function joinPreferredChannel(serverId, payload, join) {
  const channelId = preferredChannel(serverId);
  try { return await join({ ...payload, channelId }); }
  catch (error) {
    // Only channel-specific rejection can be recovered by joining main.
    // Password, network and server admission errors must remain unchanged.
    if (!channelId || channelId === 'main' || !/频道/.test(error.message || '')) throw error;
    return join({ ...payload, channelId: 'main' });
  }
}
