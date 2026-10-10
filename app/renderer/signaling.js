// ============================================================
// ScreenSh — 信令服务器连接 (已剥离废弃的 WebRTC P2P 直连逻辑)
// ============================================================
import { state, $ } from './shared.js';
import { toast } from './toast.js';
import { enterRoom, updateUserList, leaveRoom } from './room.js';

export let socket = null;
// 【新增】：集中管理房间用户状态，供 media.js 拉取虚拟 IP
export let roomUsers = new Map();

export function connectServer() {
  const url = $('#serverUrl').value.trim() || 'https://sh.rn1.me';

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  socket = io(url, { transports: ['websocket', 'polling'], timeout: 10_000, reconnection: false });

  socket.on('connect', () => {
    $('#serverStatus').className = 'status-dot connected';
    toast('已连接到信令服务器', 'success');
  });

  socket.on('disconnect', () => {
    $('#serverStatus').className = 'status-dot disconnected';
    toast('与信令服务器断开连接', 'error');
    if (state.roomId) leaveRoom();
  });

  socket.on('connect_error', () => {
    $('#serverStatus').className = 'status-dot disconnected';
    toast('无法连接到信令服务器', 'error');
  });

  // --- 房间事件 ---
  socket.on('room-created', ({ roomId, users }) => {
    state.roomId = roomId;
    enterRoom(roomId);
    roomUsers.clear();
    users.forEach(u => roomUsers.set(u.socketId, u));
    updateUserList(users);
  });

  socket.on('room-joined', ({ roomId, users }) => {
    state.roomId = roomId;
    enterRoom(roomId);

    // 更新本地用户 Map
    roomUsers.clear();
    users.forEach(u => roomUsers.set(u.socketId, u));
    updateUserList(users);
  });

  socket.on('user-joined', ({ socketId, userName, virtualIp }) => {
    toast(`${userName} 加入了房间`);
  });

  socket.on('room-update', ({ users }) => {
    roomUsers.clear();
    users.forEach(u => roomUsers.set(u.socketId, u));
    updateUserList(users);
  });

  socket.on('error', ({ message }) => toast(message, 'error'));
  socket.on('user-left', ({ socketId }) => {
    if (state.watchingId === socketId) $('#btnStopWatch').click();
  });

  // --- 共享状态事件 ---
  socket.on('peer-sharing-started', ({ socketId }) => {
    toast('有人开始共享屏幕');
    state.activeSharerId = socketId;
  });

  socket.on('peer-sharing-stopped', ({ socketId }) => {
    toast('屏幕共享已结束');
    if (state.watchingId === socketId) {
      toast('共享已结束，已返回大厅', 'error');
      $('#btnStopWatch').click();
    }
    if (state.activeSharerId === socketId) state.activeSharerId = null;
  });
  return socket;
}

export function disconnectSignaling() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

