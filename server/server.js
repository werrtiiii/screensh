const express = require('express');
const http = require('http');
const { isIPv4 } = require('net');
const { Server } = require('socket.io');

function createSignalingServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60_000, pingInterval: 25_000, maxHttpBufferSize: 64 * 1024,
  });
  const rooms = new Map();
  const channel = id => `room:${id}`;
  const users = id => Array.from(rooms.get(id)?.users || [], ([socketId, info]) => ({ socketId, ...info }));
  const update = id => io.to(channel(id)).emit('room-update', { users: users(id) });
  app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: rooms.size }));

  io.on('connection', socket => {
    const fail = message => socket.emit('error', { message });
    function validate(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
      const { roomId, userName, virtualIp } = payload;
      return typeof roomId === 'string' && /^[\p{L}\p{N}_-]{1,64}$/u.test(roomId)
        && (userName === undefined || (typeof userName === 'string' && userName.length <= 50))
        && typeof virtualIp === 'string' && isIPv4(virtualIp);
    }
    function leave() {
      const id = socket.data.roomId;
      const room = rooms.get(id);
      if (!room) return;
      room.users.delete(socket.id);
      socket.leave(channel(id));
      socket.data.roomId = null;
      if (!room.users.size) rooms.delete(id);
      else {
        if (![...room.users.values()].some(u => u.role === 'host')) room.users.values().next().value.role = 'host';
        io.to(channel(id)).emit('user-left', { socketId: socket.id });
        update(id);
      }
    }
    function enter(payload, creating) {
      if (!validate(payload)) return fail('房间号、用户名或虚拟 IP 格式不正确');
      if (socket.data.roomId) return fail('请先离开当前房间');
      const { roomId, virtualIp } = payload;
      const name = payload.userName?.trim() || '匿名用户';
      let room = rooms.get(roomId);
      if (creating && room) return fail('房间已存在，请换个房间号');
      if (!creating && !room) return fail('房间不存在');
      if (room?.users.size >= 12) return fail('房间已满（最多12人）');
      if (room && [...room.users.values()].some(u => u.virtualIp === virtualIp)) return fail('虚拟 IP 冲突，请重新加入房间');
      if (!room) { room = { users: new Map() }; rooms.set(roomId, room); }
      room.users.set(socket.id, { name, role: creating ? 'host' : 'member', isSharing: false, virtualIp });
      socket.data.roomId = roomId;
      socket.join(channel(roomId));
      socket.emit(creating ? 'room-created' : 'room-joined', { roomId, users: users(roomId) });
      if (!creating) socket.to(channel(roomId)).emit('user-joined', { socketId: socket.id, userName: name, virtualIp });
      update(roomId);
    }
    socket.on('create-room', payload => enter(payload, true));
    socket.on('join-room', payload => enter(payload, false));
    socket.on('leave-room', leave);
    socket.on('disconnect', leave);
    socket.on('list-rooms', () => socket.emit('rooms-list', Array.from(rooms, ([roomId, room]) => ({ roomId, userCount: room.users.size }))));
    for (const sharing of [true, false]) {
      socket.on(sharing ? 'start-sharing' : 'stop-sharing', () => {
        const id = socket.data.roomId;
        const user = rooms.get(id)?.users.get(socket.id);
        if (!user || user.isSharing === sharing) return;
        user.isSharing = sharing;
        socket.to(channel(id)).emit(sharing ? 'peer-sharing-started' : 'peer-sharing-stopped', { socketId: socket.id });
        update(id);
      });
    }
    // Compatibility with older clients, restricted to the sender's room.
    for (const [event, field, outgoing] of [['signal', 'to', 'signal'], ['request-view', 'target', 'view-requested'], ['stop-viewing', 'target', 'view-stopped']]) {
      socket.on(event, payload => {
        const target = payload && typeof payload === 'object' && payload[field];
        const room = rooms.get(socket.data.roomId);
        if (typeof target !== 'string' || target === socket.id || !room?.users.has(target)) return fail('目标用户不在当前房间');
        io.to(target).emit(outgoing, event === 'signal' ? { from: socket.id, data: payload.data } : { from: socket.id });
      });
    }
  });
  return { server, io };
}

if (require.main === module) {
  const { server } = createSignalingServer();
  server.listen(process.env.PORT || 3000, () => console.log(`ScreenSh 信令服务器运行在 http://localhost:${server.address().port}`));
}
module.exports = { createSignalingServer };
