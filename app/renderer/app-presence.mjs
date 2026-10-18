// A background status connection per saved server. It never joins a channel or a server room.
export function presenceTargets(storage) {
  let bookmarks;
  try { bookmarks = JSON.parse(storage.getItem('serverBookmarks') || '[]'); } catch { return []; }
  if (!Array.isArray(bookmarks)) return [];
  const urls = new Set();
  for (const item of bookmarks.slice(0, 30)) {
    try { const url = new URL(item.url); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) urls.add(url.origin); } catch {}
  }
  const targets = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith('serverIdentity:')) continue;
    const split = key.lastIndexOf(':'), url = key.slice(15, split), serverId = key.slice(split + 1), identity = storage.getItem(key);
    if (urls.has(url) && /^[a-f0-9-]{36}$/.test(serverId) && /^[a-f0-9]{64}$/.test(identity || '')) targets.push({ url, serverId, identity });
  }
  return targets;
}

export class AppPresence {
  constructor({ storage, connect }) {
    this.storage = storage; this.connect = connect; this.connections = new Map();
    this.timer = setInterval(() => { for (const entry of this.connections.values()) entry.report(); }, 15000);
    this.timer.unref?.();
  }
  sync({ retryRejected = false } = {}) {
    const groups = new Map();
    for (const target of presenceTargets(this.storage)) {
      if (!groups.has(target.url)) groups.set(target.url, []);
      groups.get(target.url).push(target);
    }
    for (const [url, entry] of this.connections) if (!groups.has(url) || retryRejected && entry.rejected) {
      entry.stop(); this.connections.delete(url);
    }
    for (const [url, targets] of groups) {
      if (this.connections.has(url)) { this.connections.get(url).targets = targets; continue; }
      const socket = this.connect(url, { forceNew: true, transports: ['websocket', 'polling'], timeout: 6000, reconnection: true, reconnectionDelay: 3000, reconnectionDelayMax: 30000 });
      const entry = { targets, identity: null, rejected: false, retry: null, pending: false };
      entry.stop = () => { clearTimeout(entry.retry); entry.identity = null; socket.removeAllListeners(); socket.disconnect(); };
      const reject = () => { entry.rejected = true; entry.stop(); };
      entry.report = () => {
        if (!socket.connected || !entry.identity || entry.pending || entry.rejected) return;
        entry.pending = true;
        socket.timeout(6000).emit('app-presence', entry.identity, (error, answer) => {
          entry.pending = false;
          if (!error && !answer?.ok) reject();
        });
      };
      socket.on('connect', () => {
        entry.identity = null;
        // Verify the instance ID before sending the server-specific identity secret.
        socket.timeout(6000).emit('server-info', {}, (error, info) => {
          if (entry.rejected || !socket.connected) return;
          if (error) {
            socket.disconnect(); entry.retry = setTimeout(() => socket.connect(), 10000); return;
          }
          const target = entry.targets.find(item => item.serverId === info?.serverId);
          if (!info?.ok || !info.appPresence || !target) { reject(); return; }
          entry.identity = { serverId: target.serverId, identity: target.identity }; entry.report();
        });
      });
      socket.on('disconnect', () => { entry.identity = null; entry.pending = false; });
      socket.on('app-presence-revoked', reject);
      this.connections.set(url, entry);
    }
  }
  stop() { clearInterval(this.timer); for (const entry of this.connections.values()) entry.stop(); this.connections.clear(); }
}
