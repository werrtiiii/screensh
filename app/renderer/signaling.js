import { syncChannelSounds, leaveChannelSounds } from './channel-sounds.mjs';
import { saveCachedImage } from './image-cache.mjs';
import { isImageData } from './image-data.mjs';
import { receiveInteraction, resetInteractions, syncInteractions } from './interactions.js';
import { state, $ } from './shared.js';
import { toast } from './toast.js';
import { updateUserList, leaveRoom } from './room.js';
import { stopWatch, stopSharing, renderViewerNames, validateRetainedWatch } from './media.js';

export let socket = null;
export const roomUsers = new Map();
const imageCache = new Map();
let imageRevision = 0;
let joinCredentials = null;
let kickedOut = false;
let reconnectPromise = null;
let reconnectGeneration = 0;
let connectedServerUrl = null, bookmarkSocketId = null;
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
      const data = result.ref === ref && isImageData(result.data) ? result.data : null;
      imageCache.set(ref, data);
    }).catch(() => { if (socket === connection) imageCache.set(ref, null); });
    imageCache.set(ref, pending);
  }
  return imageCache.get(ref);
}

export function requestServer(event, payload = {}, connection = socket, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!connection?.connected) return reject(new Error('服务器连接已断开'));
    connection.timeout(timeout).emit(event, payload, (error, response) => {
      if (error) return reject(new Error('服务器响应超时，请确认已部署新版频道服务器'));
      if (!response?.ok) return reject(new Error(response?.message || '操作失败'));
      resolve(response);
    });
  });
}
export function applyServerState(data, restoring = false) {
  if (reconnectPromise && !restoring) return;
  if (!state.roomId || data.serverId !== state.roomId) return;
  const me = data.users.find(u => u.socketId === socket?.id);
  if (!me) return;
  syncChannelSounds(data, socket.id, restoring);
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
  state.serverName = data.serverName || '0091 Server';
  $('#roomServerName').textContent = state.serverName;
  const roomIcon = $('#roomServerIcon'); if (roomIcon) { roomIcon.style.backgroundImage = state.serverIcon ? `url("${state.serverIcon}")` : ''; roomIcon.classList.toggle('has-image', !!state.serverIcon); roomIcon.textContent = state.serverIcon ? '' : 'S'; }
  document.dispatchEvent(new CustomEvent('server-icon-updated', { detail: state.serverIcon }));
  document.dispatchEvent(new CustomEvent('server-bookmark-updated', { detail: {
    url: connectedServerUrl, name: state.serverName, icon: state.serverIcon,
    iconResolved: !isImageRef(raw.serverIcon) || typeof imageCache.get(raw.serverIcon) === 'string',
    autoAdd: bookmarkSocketId !== connection.id,
  } }));
  bookmarkSocketId = connection.id;
  const meAvatar = data.users.find(u => u.socketId === socket?.id)?.avatar || null;
  if ((!isImageRef(me.avatar) || cachedImage(me.avatar)) && meAvatar !== state.userAvatar) {
    state.userAvatar = meAvatar;
    if (typeof localStorage !== 'undefined') { void saveCachedImage('avatar', meAvatar).catch(console.error); localStorage.removeItem('userAvatar'); }
    document.dispatchEvent(new CustomEvent('user-avatar-updated', { detail: meAvatar }));
  }
  state.easytierPeers = data.easytierPeers || [];
  state.serverUsers = data.users;
  roomUsers.clear();
  data.users.filter(u => u.channelId === state.channelId).forEach(u => roomUsers.set(u.socketId, u));
  validateRetainedWatch();
  syncInteractions();
  if (state.watchingId && (!roomUsers.has(state.watchingId) || !roomUsers.get(state.watchingId).isSharing)) stopWatch();
  $('#channelNameDisplay').textContent = data.channels.find(c => c.id === state.channelId)?.name || '主频道';
  updateUserList(data.users);
  window.channelVoice?.sync();
  if (state.watchingId) renderViewerNames();
}
export function connectServer() {
  imageRevision++; imageCache.clear();
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  connectedServerUrl = new URL($('#serverUrl').value.trim()).origin; bookmarkSocketId = null;
  socket = io(connectedServerUrl, { transports: ['websocket', 'polling'], timeout: 10000, reconnection: false });
  socket.on('connect', () => { $('#serverStatus').className = 'status-dot connected'; });
  socket.on('disconnect', reason => {
    resetInteractions();
    $('#serverStatus').className = 'status-dot disconnected';
    if (state.roomId && !state.leaving && !kickedOut && reason !== 'io client disconnect') startReconnect();
  });
  socket.on('server-update', applyServerState);
  socket.on('voice-signal', data => window.channelVoice?.receive(data));
  socket.on('voice-activity', data => window.channelVoice?.activity(data));
  socket.on('interaction', receiveInteraction);
  socket.on('channel-deleted', () => {
    stopWatch(); void stopSharing();
    $('#screenPicker').classList.add('hidden');
    toast('频道已删除，已返回主频道');
  });
  socket.on('kicked', () => { kickedOut = true; toast('你已被移出服务器', 'error'); void leaveRoom(); });
  socket.on('error', ({ message }) => toast(message, 'error'));
  return socket;
}
export function rememberJoinCredentials(credentials) {
  joinCredentials = credentials;
  kickedOut = false;
}
function waitForConnect(connection, timeout) {
  return new Promise((resolve, reject) => {
    if (connection.connected) return resolve();
    const timer = setTimeout(() => {
      connection.off('connect', ready); connection.off('connect_error', failed);
      reject(new Error('连接服务器超时'));
    }, timeout);
    const ready = () => { clearTimeout(timer); connection.off('connect_error', failed); resolve(); };
    const failed = error => { clearTimeout(timer); connection.off('connect', ready); reject(new Error(error.message || '连接失败')); };
    connection.once('connect', ready); connection.once('connect_error', failed);
  });
}
async function reconnectJoin(deadline, previousChannel) {
  const credentials = joinCredentials;
  if (!credentials || !state.roomId || !state.virtualIp || state.leaving || kickedOut) throw new Error('已取消重连');
  const generation = reconnectGeneration;
  const connection = connectServer();
  const remaining = () => Math.max(1, deadline - Date.now());
  const check = () => { if (Date.now() >= deadline || generation !== reconnectGeneration || state.leaving || kickedOut || socket !== connection || !state.roomId) throw new Error('已取消重连'); };
  const request = async (event, payload = {}) => { check(); const result = await requestServer(event, payload, connection, remaining()); check(); return result; };
  await waitForConnect(connection, Math.min(3000, remaining()));
  if (generation !== reconnectGeneration || !state.roomId || state.leaving || kickedOut) throw new Error('已取消重连');
  const info = await request('server-info');
  if (info.protocol !== 2 || info.serverId !== state.roomId) throw new Error('服务器已变化，请重新连接');
  if (info.passwordRequired && !credentials.password) throw new Error('服务器需要密码，请重新输入');
  const access = await request('check-access', { userName: credentials.userName, password: credentials.password, identity: credentials.identity });
  if (!Array.isArray(access.easytierPeers)) throw new Error('请更新服务端以使用统一组网节点');
  let joined = await request('join-server', {
    userName: credentials.userName, identity: credentials.identity, password: credentials.password,
    easytierPeers: access.easytierPeers, virtualIp: state.virtualIp, avatar: state.userAvatar, voiceDeafened: localStorage.getItem('voiceDeafened') === 'true',
  });
  if (generation !== reconnectGeneration || !connection.connected) throw new Error('连接已断开');
  if (previousChannel !== 'main' && joined.channels.some(c => c.id === previousChannel)) joined = await request('switch-channel', { channelId: previousChannel });
  if (state.isSharing) {
    if (joined.users.find(u => u.socketId === connection.id)?.channelId !== previousChannel) await stopSharing();
    else { await request('start-sharing'); joined = await request('switch-channel', { channelId: previousChannel }); }
  }
  check();
  applyServerState(joined, true);
  return joined;
}
function startReconnect() {
  if (reconnectPromise) return;
  const deadline = Date.now() + 5000;
  const previousChannel = state.channelId;
  const generation = reconnectGeneration;
  const voiceStopping = window.channelVoice?.stop({ keepTest: true });
  $('#serverStatus').className = 'status-dot reconnecting';
  toast('与服务器连接中断，正在重连…', 'error');
  reconnectPromise = (async () => {
    let lastError = null;
    let cleanupTimer;
    try {
      await Promise.race([Promise.resolve(voiceStopping), new Promise(resolve => { cleanupTimer = setTimeout(resolve, Math.max(0, deadline - Date.now())); })]);
    } catch (error) { lastError = error; }
    finally { clearTimeout(cleanupTimer); }
    while (Date.now() < deadline && state.roomId && !state.leaving && !kickedOut) {
      try {
        await reconnectJoin(deadline, previousChannel);
        toast('已重新连接到服务器', 'success');
        $('#serverStatus').className = 'status-dot connected';
        reconnectPromise = null;
        window.channelVoice?.sync();
        return;
      } catch (error) {
        lastError = error;
        if (generation !== reconnectGeneration || !state.roomId || state.leaving || kickedOut) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
      }
    }
    if (generation !== reconnectGeneration || !state.roomId || state.leaving || kickedOut) return;
    reconnectPromise = null;
    toast(lastError && !/超时|连接失败|已取消/.test(lastError.message) ? lastError.message : '与服务器断开连接，自动重连失败', 'error');
    await leaveRoom();
  })();
}
export function disconnectSignaling() {
  connectedServerUrl = null; bookmarkSocketId = null;
  resetInteractions();
  leaveChannelSounds();
  imageRevision++; imageCache.clear();
  reconnectGeneration++;
  reconnectPromise = null;
  joinCredentials = null;
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

