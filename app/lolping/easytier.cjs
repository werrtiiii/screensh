const dgram = require('node:dgram');
const { wireEvent } = require('./room.cjs');
const { isIPv4 } = require('node:net');
const { generateKeyPairSync, createPublicKey, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const VERSION = 1, MAX_PACKET = 1200, MAX_PEERS = 512;
const publicKeyValid = value => typeof value === 'string' && /^[A-Za-z0-9+/]{59}=$/.test(value)
  && Buffer.from(value, 'base64').length === 44 && Buffer.from(value, 'base64').toString('base64') === value
  && Buffer.from(value, 'base64').subarray(0, 12).toString('hex') === '302a300506032b656e032100';
const virtualIpValid = (ip, loopback) => isIPv4(ip) && (/^10\.144\./.test(ip) || loopback && /^127\./.test(ip));

// Membership is supplied by the authenticated channel server. All event data
// goes directly over sockets bound to the EasyTier interface, never broadcast.
class EasyTierLolPing {
  constructor({ context, onPacket, onError, validEvent, allowLoopback = false }) {
    if (!virtualIpValid(context.virtualIp, allowLoopback)) throw Error('lolPing 需要有效的 EasyTier 虚拟 IP');
    this.context = context; this.onPacket = onPacket; this.onError = onError; this.validEvent = validEvent; this.allowLoopback = allowLoopback;
    const keys = generateKeyPairSync('x25519'); this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    this.aad = Buffer.from(JSON.stringify(['ScreenSh/lolPing/EasyTier/1', context.serverId, context.channelId]));
    this.peers = new Map(); this.peerCache = new Map(); this.sequence = 0; this.closed = false; this.endpoint = null;
    this.tokens = 20; this.refill = Date.now();
    this.receiveTokens = 400; this.receiveRefill = Date.now();
  }
  async start() {
    const socket = this.socket = dgram.createSocket('udp4');
    socket.on('message', (bytes, remote) => this.read(bytes, remote));
    await new Promise((resolve, reject) => {
      const failed = error => { socket.removeListener('listening', ready); reject(error); };
      const ready = () => { socket.removeListener('error', failed); resolve(); };
      socket.once('error', failed); socket.once('listening', ready);
      socket.bind(0, this.context.virtualIp);
    }).catch(() => { throw Error('lolPing 无法绑定 EasyTier 虚拟网卡，请确认虚拟网络已连接'); });
    socket.on('error', error => { if (!this.closed) this.onError(error); });
    this.endpoint = { port: socket.address().port, publicKey: this.publicKey };
    return this.endpoint;
  }
  updatePeers(raw) {
    const peers = new Map();
    for (const p of Array.isArray(raw) ? raw.slice(0, MAX_PEERS) : []) {
      const endpoint = p?.lolpingEndpoint;
      if (p?.channelId !== this.context.channelId || typeof p.socketId !== 'string' || p.socketId === this.context.socketId
        || !virtualIpValid(p.virtualIp, this.allowLoopback) || !Number.isInteger(endpoint?.port) || endpoint.port < 1024 || endpoint.port > 65535 || !publicKeyValid(endpoint.publicKey)) continue;
      const address = `${p.virtualIp}:${endpoint.port}`, cacheKey = `${p.socketId}:${endpoint.publicKey}`, old = this.peerCache.get(cacheKey);
      if (old) { Object.assign(old, { ip: p.virtualIp, port: endpoint.port, name: String(p.name || '').slice(0, 40) }); peers.set(address, old); continue; }
      try {
        const publicKey = createPublicKey({ key: Buffer.from(endpoint.publicKey, 'base64'), type: 'spki', format: 'der' });
        const secret = diffieHellman({ privateKey: this.privateKey, publicKey });
        const ids = [p.socketId, this.context.socketId].sort();
        const key = Buffer.from(hkdfSync('sha256', secret, this.aad, Buffer.from(JSON.stringify(ids)), 32));
        const peer = { socketId: p.socketId, publicKey: endpoint.publicKey, ip: p.virtualIp, port: endpoint.port, name: String(p.name || '').slice(0, 40),
          key, highest: 0, seen: new Set(), tokens: 40, refill: Date.now() };
        peers.set(address, peer); this.peerCache.set(cacheKey, peer);
        if (this.peerCache.size > MAX_PEERS * 2) this.peerCache.delete(this.peerCache.keys().next().value);
      } catch {} // Invalid public keys cannot participate or stop other peers.
    }
    this.peers = peers;
  }
  send(event) {
    if (this.closed || !this.endpoint || !this.validEvent(event)) return;
    const now = Date.now(); this.tokens = Math.min(20, this.tokens + Math.max(0, now - this.refill) / 50); this.refill = now;
    if (this.tokens < 1) return;
    this.tokens--;
    const body = Buffer.from(JSON.stringify({ v: VERSION, from: this.context.socketId, seq: ++this.sequence,
      ...wireEvent(event) }));
    if (body.length + 29 > MAX_PACKET) return;
    for (const peer of this.peers.values()) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', peer.key, nonce); cipher.setAAD(this.aad);
      const packet = Buffer.concat([Buffer.from([VERSION]), nonce, cipher.update(body), cipher.final(), cipher.getAuthTag()]);
      this.socket.send(packet, peer.port, peer.ip, () => {}); // Unreachable peers never interrupt local input.
    }
  }
  read(bytes, remote) {
    if (this.closed || bytes.length < 29 || bytes.length > MAX_PACKET || bytes[0] !== VERSION) return;
    const peer = this.peers.get(`${remote.address}:${remote.port}`); if (!peer) return;
    const now = Date.now();
    this.receiveTokens = Math.min(400, this.receiveTokens + Math.max(0, now - this.receiveRefill) / 5); this.receiveRefill = now;
    if (this.receiveTokens < 1) return; this.receiveTokens--;
    peer.tokens = Math.min(40, peer.tokens + Math.max(0, now - peer.refill) / 25); peer.refill = now;
    if (peer.tokens < 1) return; peer.tokens--;
    try {
      const decipher = createDecipheriv('aes-256-gcm', peer.key, bytes.subarray(1, 13)); decipher.setAAD(this.aad); decipher.setAuthTag(bytes.subarray(-16));
      const packet = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(13, -16)), decipher.final()]).toString('utf8'));
      if (packet.v !== VERSION || packet.from !== peer.socketId || !Number.isSafeInteger(packet.seq) || packet.seq < 1
        || packet.seq <= peer.highest - 128 || peer.seen.has(packet.seq) || !this.validEvent(packet)) return;
      peer.highest = Math.max(peer.highest, packet.seq); peer.seen.add(packet.seq);
      for (const seq of peer.seen) if (seq <= peer.highest - 128) peer.seen.delete(seq);
      this.onPacket({ ...wireEvent(packet), from: peer.socketId, name: peer.name,
        serverId: this.context.serverId, channelId: this.context.channelId });
    } catch {} // Authentication failures, malformed packets and replays are ignored.
  }
  stop() {
    this.closed = true; this.endpoint = null; this.peers.clear(); this.peerCache.clear();
    const socket = this.socket; this.socket = null;
    if (!socket) return Promise.resolve();
    return new Promise(resolve => { try { socket.close(resolve); } catch { resolve(); } });
  }
}
module.exports = { EasyTierLolPing, publicKeyValid };
