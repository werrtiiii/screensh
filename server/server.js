const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: rooms.size }));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('create-room', async ({ roomId, userName }) => {
    if (rooms.has(roomId)) {
      socket.emit('error', { message: '房间已存在，请换个房间号' });
      return;
    }

    rooms.set(roomId, {
      users: new Map()
    });

    socket.join(roomId);
    rooms.get(roomId).users.set(socket.id, { name: userName || '匿名用户', role: 'host', isSharing: false });
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    socket.emit('room-created', { roomId });
    io.to(roomId).emit('room-update', { users: getRoomUsers(roomId) });
    console.log(`[room] ${roomId} created by ${socket.id}`);
  });

  socket.on('join-room', ({ roomId, userName }) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    if (rooms.get(roomId).users.size >= 12) {
      socket.emit('error', { message: '房间已满（最多12人）' });
      return;
    }
    socket.join(roomId);
    rooms.get(roomId).users.set(socket.id, { name: userName || '匿名用户', role: 'member', isSharing: false });
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    socket.to(roomId).emit('user-joined', { socketId: socket.id, userName: userName || '匿名用户' });
    socket.emit('room-joined', { roomId, users: getRoomUsers(roomId) });
    io.to(roomId).emit('room-update', { users: getRoomUsers(roomId) });
    console.log(`[room] ${socket.id} joined ${roomId}`);
  });

  socket.on('list-rooms', () => {
    const list = [];
    for (const [roomId, room] of rooms) {
      list.push({ roomId, userCount: room.users.size });
    }
    socket.emit('rooms-list', list);
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('start-sharing', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const user = rooms.get(roomId).users.get(socket.id);
    if (user) user.isSharing = true;
    socket.to(roomId).emit('peer-sharing-started', { socketId: socket.id });
    io.to(roomId).emit('room-update', { users: getRoomUsers(roomId) });
  });

  socket.on('stop-sharing', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const user = room.users.get(socket.id);
    if (user) user.isSharing = false;

    socket.to(roomId).emit('peer-sharing-stopped', { socketId: socket.id });
    io.to(roomId).emit('room-update', { users: getRoomUsers(roomId) });
  });

  socket.on('request-view', ({ target }) => {
    io.to(target).emit('view-requested', { from: socket.id });
  });

  socket.on('stop-viewing', ({ target }) => {
    io.to(target).emit('view-stopped', { from: socket.id });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.users.delete(socket.id);

      if (room.users.size > 0) {
        let hasHost = false;
        for (const user of room.users.values()) {
          if (user.role === 'host') hasHost = true;
        }
        if (!hasHost) {
          const firstUser = room.users.values().next().value;
          firstUser.role = 'host';
        }
      }

      socket.to(roomId).emit('user-left', { socketId: socket.id });
      io.to(roomId).emit('room-update', { users: getRoomUsers(roomId) });

      if (room.users.size === 0) {
        rooms.delete(roomId);
        console.log(`[room] ${roomId} deleted (empty)`);
      }
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.users.entries()).map(([socketId, info]) => ({
    socketId,
    name: info.name,
    role: info.role,
    isSharing: info.isSharing
  }));
}

server.listen(PORT, () => {
  console.log(`ScreenSh 信令服务器运行在 http://localhost:${PORT}`);
});
