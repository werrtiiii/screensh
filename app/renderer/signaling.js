import { state, $ } from './shared.js';
import { toast } from './toast.js';
import { updateUserList, leaveRoom } from './room.js';
import { stopWatch, stopSharing, renderViewerNames } from './media.js';

export let socket = null;
export const roomUsers = new Map();
const imageCache = new Map();
let imageRevision = 0;
const isImageRef = value => /^image:[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(value || '');
function cachedImage(value) {
  if (!isImageRef(value)) return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
  const cached = imageCache.get(value);
  return typeof cached === 'string' ? cached : null;
}
function fetchImage(ref, connection) {
  if (!imageCache.has(ref)) {
    const pending = requestServer('get-image', { ref }, connection).then(result => {
      if (socket !== connection) return;
      const data = result.ref === ref && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(result.data || '') && result.data.length <= 128 * 1024 ? result.data : null;
      imageCache.set(ref, data);
    }).catch(() => { if (socket === connection) imageCache.set(ref, null); });
    imageCache.set(ref, pending);
  }
  return imageCache.get(ref);
}

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
  const revision = ++imageRevision, connection = socket;
  const raw = data;
  const refs = new Set([data.serverIcon, ...data.users.map(u => u.avatar)].filter(isImageRef));
  for (const ref of imageCache.keys()) if (!refs.has(ref)) imageCache.delete(ref);
  const loading = [...refs].filter(ref => !imageCache.has(ref) || imageCache.get(ref) instanceof Promise);
  data = { ...data, serverIcon: cachedImage(data.serverIcon), users: data.users.map(u => ({ ...u, avatar: cachedImage(u.avatar) })) };
  if (loading.length) Promise.all(loading.map(ref => fetchImage(ref, connection))).then(() => {
    if (revision === imageRevision && socket === connection) applyServerState(raw);
  });
  if (state.channelId && me.channelId !== state.channelId) stopWatch();
  state.channelId = me.channelId;
  state.channels = data.channels;
  state.passwordRequired = !!data.passwordRequired;
  state.serverIcon = data.serverIcon || null;
  const roomIcon = $('#roomServerIcon'); if (roomIcon) { roomIcon.style.backgroundImage = state.serverIcon ? `url("${state.serverIcon}")` : ''; roomIcon.classList.toggle('has-image', !!state.serverIcon); roomIcon.textContent = state.serverIcon ? '' : 'S'; }
  document.dispatchEvent(new CustomEvent('server-icon-updated', { detail: state.serverIcon }));
  const meAvatar = data.users.find(u => u.socketId === socket?.id)?.avatar || null;
  if ((!isImageRef(me.avatar) || cachedImage(me.avatar)) && meAvatar !== state.userAvatar) {
    state.userAvatar = meAvatar;
    if (typeof localStorage !== 'undefined') { if (meAvatar) localStorage.setItem('userAvatar', meAvatar); else localStorage.removeItem('userAvatar'); }
    document.dispatchEvent(new CustomEvent('user-avatar-updated', { detail: meAvatar }));
  }
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
  imageRevision++; imageCache.clear();
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
  imageRevision++; imageCache.clear();
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

