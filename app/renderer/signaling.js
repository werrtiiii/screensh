import { state, $ } from './shared.js';
import { toast } from './toast.js';
import { updateUserList, leaveRoom } from './room.js';
import { stopWatch, stopSharing, renderViewerNames } from './media.js';

export let socket = null;
export const roomUsers = new Map();

export function requestServer(event, payload = {}, connection = socket) {
  return new Promise((resolve, reject) => {
    if (!connection?.connected) return reject(new Error('服务器连接已断开'));
    connection.timeout(10000).emit(event, payload, (error, response) => {
      if (error) return reject(new Error('服务器响应超时，请确认已部署新版频道服务器'));
      if (!response?.ok) return reject(new Error(response?.message || '操作失败'));
      resolve(response);
    });
  });
}
export function applyServerState(data) {
  if (!state.roomId || data.serverId !== state.roomId) return;
  const me = data.users.find(u => u.socketId === socket?.id);
  if (!me) return;
  if (state.channelId && me.channelId !== state.channelId) stopWatch();
  state.channelId = me.channelId;
  state.channels = data.channels;
  state.passwordRequired = !!data.passwordRequired;
  state.easytierPeers = data.easytierPeers || [];
  state.serverUsers = data.users;
  roomUsers.clear();
  data.users.filter(u => u.channelId === state.channelId).forEach(u => roomUsers.set(u.socketId, u));
  if (state.watchingId && (!roomUsers.has(state.watchingId) || !roomUsers.get(state.watchingId).isSharing)) stopWatch();
  $('#channelNameDisplay').textContent = data.channels.find(c => c.id === state.channelId)?.name || '主频道';
  updateUserList(data.users);
  if (state.watchingId) renderViewerNames();
}
export function connectServer() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  socket = io($('#serverUrl').value.trim(), { transports: ['websocket', 'polling'], timeout: 10000, reconnection: false });
  socket.on('connect', () => { $('#serverStatus').className = 'status-dot connected'; });
  socket.on('disconnect', () => {
    $('#serverStatus').className = 'status-dot disconnected';
    if (state.roomId) { toast('与服务器断开连接', 'error'); void leaveRoom(); }
  });
  socket.on('server-update', applyServerState);
  socket.on('channel-deleted', () => {
    stopWatch(); void stopSharing();
    $('#screenPicker').classList.add('hidden');
    toast('频道已删除，已返回主频道');
  });
  socket.on('kicked', () => { toast('你已被移出服务器', 'error'); void leaveRoom(); });
  socket.on('error', ({ message }) => toast(message, 'error'));
  return socket;
}
export function disconnectSignaling() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

