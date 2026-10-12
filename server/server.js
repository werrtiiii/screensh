const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash, randomBytes, scrypt, timingSafeEqual } = require('crypto');
const derivePassword = require('util').promisify(scrypt);
const { isIPv4 } = require('net');
const { Server } = require('socket.io');
const { normalizePeers } = require('./easytier-peers.cjs');

function createSignalingServer({ stateFile = null, initialPeers = process.env.SCREENSH_EASYTIER_PEERS } = {}) {
  let saved = { version: 2, serverId: randomUUID(), owner: null, admins: [], channels: [{ id: 'main', name: '主频道' }] };
  if (stateFile && fs.existsSync(stateFile)) {
    saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved.version !== 2 || !/^[a-f0-9-]{36}$/.test(saved.serverId) || !Array.isArray(saved.admins)
      || !Array.isArray(saved.channels) || !saved.channels.some(c => c.id === 'main')
      || (saved.password && (!/^[a-f0-9]{32}$/.test(saved.password.salt) || !/^[a-f0-9]{64}$/.test(saved.password.hash)))) throw new Error('服务器状态文件无效，请从备份恢复');
  }
  function persist(next) {
    if (stateFile) {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(stateFile + '.tmp', stateFile);
    }
    saved = next;
  }
  // Deployment peers initialize new state; persisted room settings take precedence afterward.
  if (saved.easytierPeers == null && (initialPeers == null || typeof initialPeers === 'string' && !initialPeers.trim())) {
    throw new Error('请在部署配置中设置 SCREENSH_EASYTIER_PEERS 组网节点');
  }
  saved.easytierPeers = normalizePeers(saved.easytierPeers ?? initialPeers);
  persist(saved);
  const app = express(), server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] }, pingTimeout: 60000, pingInterval: 25000, maxHttpBufferSize: 64 * 1024 });
  const members = new Map();
  const attempts = new Map();
  const nameKey = name => name.normalize('NFKC').toLowerCase();
  async function checkAccess(socket, payload) {
    const name = payload?.userName;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 20 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('请填写有效名称（1至20个字符）');
    const passwordRecord = saved.password;
    if (passwordRecord) {
      const now = Date.now(), ip = socket.handshake.address;
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const entry = attempts.get(ip) || { count: 0, until: now + 60000 };
      if (entry.count >= 20 || attempts.size >= 10000 && !attempts.has(ip)) throw new Error('密码尝试过于频繁，请一分钟后重试');
      entry.count++; attempts.set(ip, entry);
      if (typeof payload.password !== 'string' || !payload.password.length || payload.password.length > 128) throw new Error('请输入服务器密码');
      const digest = await derivePassword(payload.password, passwordRecord.salt, 32);
      if (saved.password !== passwordRecord) throw new Error('服务器密码已变更，请重新连接');
      if (!timingSafeEqual(digest, Buffer.from(passwordRecord.hash, 'hex'))) throw new Error('服务器密码错误');
      entry.count = Math.max(0, entry.count - 1);
    }
    if ([...members.values()].some(u => nameKey(u.name) === nameKey(name.trim()))) throw new Error('名称已被使用，请换一个');
  }
  const role = key => key === saved.owner ? 'host' : saved.admins.includes(key) ? 'admin' : 'member';
  const snapshot = () => ({ serverId: saved.serverId, channels: saved.channels, easytierPeers: saved.easytierPeers, passwordRequired: !!saved.password,
    users: [...members].map(([socketId, u]) => ({ socketId, name: u.name, virtualIp: u.virtualIp,
      channelId: u.channelId, isSharing: u.isSharing, watchingId: u.watchingId || null, role: role(u.key) })) });
  const publish = () => {
    for (const u of members.values()) {
      const target = members.get(u.watchingId);
      if (!target?.isSharing || target.channelId !== u.channelId) u.watchingId = null;
    }
    io.to('members').emit('server-update', snapshot());
  };
  const group = id => 'channel:' + id;
  app.get('/health', (_req, res) => res.json({ status: 'ok', protocol: 2, rooms: 1, channels: saved.channels.length, users: members.size }));
  io.on('connection', socket => {
    const handle = (name, fn) => socket.on(name, async (payload, ack) => {
      try { const result = await fn(payload); if (typeof ack === 'function') ack({ ok: true, ...result }); }
      catch (error) {
        const message = error.code ? '服务器无法保存配置，请联系服务器维护者' : error.message;
        if (typeof ack === 'function') ack({ ok: false, message }); else socket.emit('error', { message });
      }
    });
    const requireMember = () => { const u = members.get(socket.id); if (!u) throw new Error('请先进入服务器'); return u; };
    handle('server-info', () => ({ protocol: 2, serverId: saved.serverId, passwordRequired: !!saved.password }));
    handle('check-access', async payload => { await checkAccess(socket, payload); return { easytierPeers: saved.easytierPeers }; });
    handle('join-server', async payload => {
      const accessPassword = saved.password;
      await checkAccess(socket, payload);
      if (!socket.connected) throw new Error('连接已断开');
      if (saved.password !== accessPassword) throw new Error('服务器密码已变更，请重新连接');
      if (members.has(socket.id)) throw new Error('已进入服务器');
      if (JSON.stringify(payload?.easytierPeers) !== JSON.stringify(saved.easytierPeers)) throw new Error('组网节点已变更或客户端版本过旧，请更新客户端后重新连接');
      if (!payload || typeof payload.userName !== 'string' || !payload.userName.trim() || payload.userName.trim().length > 20
        || /[\x00-\x1f\x7f]/.test(payload.userName) || typeof payload.virtualIp !== 'string' || !isIPv4(payload.virtualIp)
        || typeof payload.identity !== 'string' || !/^[a-f0-9]{64}$/.test(payload.identity)) throw new Error('请填写有效名称和连接信息');
      if (members.size >= 100) throw new Error('服务器已满（最多100人）');
      const key = createHash('sha256').update(payload.identity).digest('hex');
      if ([...members.values()].some(u => u.key === key)) throw new Error('本机身份已在线，请先退出原连接');
      if ([...members.values()].some(u => u.virtualIp === payload.virtualIp)) throw new Error('虚拟 IP 冲突，请重新连接');
      if ([...members.values()].some(u => nameKey(u.name) === nameKey(payload.userName.trim()))) throw new Error('名称已被使用，请换一个');
      if (!saved.owner) persist({ ...saved, owner: key });
      members.set(socket.id, { key, name: payload.userName.trim(), virtualIp: payload.virtualIp, channelId: 'main', isSharing: false });
      socket.join('members'); socket.join(group('main')); publish();
      return snapshot();
    });
    handle('set-server-peers', payload => {
      if (role(requireMember().key) !== 'host') throw new Error('只有房主可以修改组网节点');
      const easytierPeers = normalizePeers(payload?.peers);
      persist({ ...saved, easytierPeers }); publish(); return { easytierPeers };
    });
    handle('set-server-password', async payload => {
      if (role(requireMember().key) !== 'host') throw new Error('只有房主可以设置服务器密码');
      if (typeof payload?.enabled !== 'boolean') throw new Error('无效的密码设置');
      let password = null;
      if (payload.enabled) {
        if (typeof payload.password !== 'string' || !payload.password.trim() || payload.password.length > 128) throw new Error('密码需为1至128个字符，不能全为空格');
        const salt = randomBytes(16).toString('hex');
        password = { salt, hash: (await derivePassword(payload.password, salt, 32)).toString('hex') };
      }
      if (role(requireMember().key) !== 'host') throw new Error('房主连接已失效');
      persist({ ...saved, password }); publish(); return {};
    });
    handle('create-channel', payload => {
      if (role(requireMember().key) === 'member') throw new Error('只有房主和管理员可以创建频道');
      const name = payload?.name;
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 30 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('频道名称需为1至30个字符');
      if (saved.channels.some(c => c.name === name.trim())) throw new Error('频道名称已存在');
      if (saved.channels.length >= 50) throw new Error('最多创建50个频道');
      const channel = { id: randomUUID(), name: name.trim() };
      persist({ ...saved, channels: [...saved.channels, channel] }); publish(); return { channel };
    });
    handle('delete-channel', payload => {
      if (role(requireMember().key) === 'member') throw new Error('只有房主和管理员可以删除频道');
      const id = payload?.channelId;
      if (id === 'main') throw new Error('主频道不能删除');
      if (!saved.channels.some(c => c.id === id)) throw new Error('频道不存在');
      persist({ ...saved, channels: saved.channels.filter(c => c.id !== id) });
      for (const [sid, member] of members) if (member.channelId === id) {
        const client = io.sockets.sockets.get(sid);
        client?.leave(group(id)); client?.join(group('main'));
        member.channelId = 'main'; member.isSharing = false;
        client?.emit('channel-deleted');
      }
      publish(); return {};
    });
    handle('kick-member', payload => {
      const actor = requireMember(), target = members.get(payload?.socketId);
      const rank = { host: 2, admin: 1, member: 0 };
      if (!target || rank[role(actor.key)] <= rank[role(target.key)]) throw new Error('只能踢出权限低于自己的成员');
      const client = io.sockets.sockets.get(payload.socketId);
      client?.emit('kicked'); client?.disconnect(true);
      return {};
    });
    handle('set-admin', payload => {
      if (role(requireMember().key) !== 'host') throw new Error('只有房主可以设置管理员');
      const target = members.get(payload?.socketId);
      if (!target || target.key === saved.owner || typeof payload.enabled !== 'boolean') throw new Error('无效的管理员设置');
      const admins = saved.admins.filter(k => k !== target.key);
      if (payload.enabled) admins.push(target.key);
      persist({ ...saved, admins }); publish(); return {};
    });
    handle('switch-channel', payload => {
      const u = requireMember();
      if (!saved.channels.some(c => c.id === payload?.channelId)) throw new Error('频道不存在');
      if (u.channelId !== payload.channelId) {
        socket.leave(group(u.channelId)); u.channelId = payload.channelId; u.isSharing = false;
        socket.join(group(u.channelId)); publish();
      }
      return snapshot();
    });
    for (const sharing of [true, false]) handle(sharing ? 'start-sharing' : 'stop-sharing', () => {
      const u = requireMember(); u.isSharing = sharing; publish(); return {};
    });
    function leave() {
      const u = members.get(socket.id); if (!u) return;
      members.delete(socket.id); socket.leave('members'); socket.leave(group(u.channelId)); publish();
    }
    handle('leave-server', () => { leave(); return {}; });
    socket.on('disconnect', leave);
    for (const name of ['create-room', 'join-room']) handle(name, () => { throw new Error('服务器已升级为频道模式，请更新客户端'); });
    handle('request-view', payload => {
      const u = requireMember(), target = members.get(payload?.target);
      if (!target?.isSharing || target === u || target.channelId !== u.channelId) throw new Error('该共享当前不可观看');
      u.watchingId = payload.target; publish(); return {};
    });
    handle('stop-viewing', payload => {
      const u = requireMember();
      if (!payload?.target || u.watchingId === payload.target) { u.watchingId = null; publish(); }
      return {};
    });
    for (const [name, field, outgoing] of [['signal', 'to', 'signal']]) {
      handle(name, payload => {
        const u = requireMember(), target = members.get(payload?.[field]);
        if (!target || target === u || target.channelId !== u.channelId) throw new Error('目标用户不在当前频道');
        io.to(payload[field]).emit(outgoing, name === 'signal' ? { from: socket.id, data: payload.data } : { from: socket.id }); return {};
      });
    }
  });
  return { server, io };
}
if (require.main === module) {
  const { server } = createSignalingServer({ stateFile: process.env.SCREENSH_STATE_FILE || path.join(__dirname, 'data', 'server-state.json') });
  server.listen(process.env.PORT || 3000, () => console.log('ScreenSh 频道服务器运行于端口 ' + server.address().port));
}
module.exports = { createSignalingServer };
