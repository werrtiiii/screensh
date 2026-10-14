// ============================================================
// ScreenSh — 房间进出 + 成员列表 + 大厅卡片网格
// ============================================================
import { state, $ } from './shared.js';
import { socket, roomUsers, disconnectSignaling, requestServer, applyServerState } from './signaling.js';
import { toast } from './toast.js';
import { requestPassword } from './password-dialog.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';
import { normalizePeers } from './easytier-peers.mjs';
import {
  escapeHtml,
  displayRemoteVideo,
  updateSharingUI,
  stopWatch,
  stopSharing,
} from './media.js';
// --- 成员列表 + 卡片网格 ---

export function updateUserList(users) {
  // 侧边栏列表
  const list = $('#userList');
  $('#userCount').textContent = users.length;
  list.innerHTML = users
    .map((u) => {
      const isMe = u.socketId === socket?.id;
      return `
        <li class="${isMe ? 'me' : ''}">
          <span class="member-avatar default-avatar" aria-hidden="true">👤${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" onerror="this.remove()" />` : ''}</span>
          <span>${escapeHtml(u.name)}</span>
          <small class="user-channel">${escapeHtml(state.channels.find(c => c.id === u.channelId)?.name || '')}</small>
        </li>
      `;
    })
    .join('');

  const myRole = users.find(u => u.socketId === socket?.id)?.role;
  const rank = { host: 2, admin: 1, member: 0 };
  [...list.children].forEach((row, index) => {
    const user = users[index];
    row.oncontextmenu = event => {
      const actions = [];
      if (myRole === 'host' && user.role !== 'host') actions.push({
        label: user.role === 'admin' ? '移除管理员' : '设为管理员',
        run: () => perform('set-admin', { socketId: user.socketId, enabled: user.role !== 'admin' })
      });
      if (rank[myRole] > rank[user.role]) actions.push({ label: '踢出服务器', run: () => perform('kick-member', { socketId: user.socketId }) });
      if (rank[myRole] > rank[user.role] && user.channelId === state.channelId) actions.push({ label: user.voiceMuted ? '解除禁言' : '禁言', run: () => perform('set-member-mute', { socketId: user.socketId, muted: !user.voiceMuted }) });
      showContextMenu(event, actions);
    };
  });
  renderChannels(users);
  users = users.filter(u => u.channelId === state.channelId);
  // 同步共享者状态
  const sharer = users.find((u) => u.isSharing);
  state.activeSharerId = sharer ? sharer.socketId : null;

  // 大厅卡片网格
  const cardsView = $('#userCardsView');
  if (!cardsView) return;
  cardsView.innerHTML = '';

  users.forEach((u) => {
    const isMe = u.socketId === socket?.id;
    const isSharing = u.isSharing;

    const card = document.createElement('div');
    card.className = 'user-card';

    let btnHtml = '';
    if (isMe && isSharing) {
      btnHtml = `<button class="btn btn-primary btn-sm btn-watch">▶ 观看共享</button>`;
    } else if (isMe) {
      btnHtml = `<button class="btn btn-outline btn-sm btn-watch" disabled>未共享</button>`;
    } else if (isSharing) {
      btnHtml = `<button class="btn btn-primary btn-sm btn-watch">▶ 观看共享</button>`;
    } else {
      btnHtml = `<button class="btn btn-outline btn-sm btn-watch" disabled>未共享</button>`;
    }

    const displayName = escapeHtml(u.name);

    card.innerHTML = `
      <div class="card-cover"><div class="avatar">👤${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" onerror="this.remove()" />` : ''}</div>
      ${isSharing ? btnHtml : ''}</div>
      <div class="name">${displayName}</div>
    `;

    // 自己和其他成员都播放实际共享流。
    if (isSharing) {
      card.querySelector('.btn-watch').addEventListener('click', () => {
        displayRemoteVideo(u.socketId);
      });
    }

    cardsView.appendChild(card);
    window.channelVoice?.decorate(card, u, isMe);
    if (rank[myRole] > rank[u.role]) card.oncontextmenu = event => showContextMenu(event, [{ label: u.voiceMuted ? '解除禁言' : '禁言', run: () => perform('set-member-mute', { socketId: u.socketId, muted: !u.voiceMuted }) }]);
  });
}

// --- 房间进出 ---
function renderChannels(users) {
  const me = users.find(u => u.socketId === socket?.id);
  $('#btnServerSettings').classList.toggle('hidden', me?.role !== 'host');
  if (me?.role !== 'host') $('#serverSettingsDialog').classList.add('hidden');
  $('#btnServerPassword').classList.toggle('hidden', me?.role !== 'host');
  $('#btnServerPeers').classList.toggle('hidden', me?.role !== 'host');
  $('#btnServerPassword').textContent = state.passwordRequired ? '服务器密码 · 已设置' : '服务器密码';
  const canManage = ['host', 'admin'].includes(me?.role);
  $('#btnAddChannel').classList.toggle('hidden', !canManage);
  if (!canManage) $('#channelDialog').classList.add('hidden');
  const list = $('#channelList'); list.innerHTML = '';
  for (const channel of state.channels) {
    const button = document.createElement('button');
    button.className = 'btn btn-outline btn-sm channel-button' + (channel.id === state.channelId ? ' active' : '');
    button.textContent = `${channel.name} (${users.filter(u => u.channelId === channel.id).length})`;
    button.disabled = state.switchingChannel || state.leaving;
    button.onclick = () => switchChannel(channel.id);
    button.oncontextmenu = event => showContextMenu(event, canManage ? [{ label: channel.id === 'main' ? '主频道不能删除' : '删除频道', disabled: channel.id === 'main', run: () => perform('delete-channel', { channelId: channel.id }) }] : []);
    list.append(button);
  }
}

export async function switchChannel(channelId) {
  if (state.switchingChannel || state.leaving || channelId === state.channelId || !state.roomId) return;
  state.switchingChannel = true; renderChannels(state.serverUsers); updateSharingUI(state.isSharing);
  try {
    if (!await stopSharing()) throw new Error('当前共享未能停止，请重试后再切换频道');
    await window.channelVoice?.stop();
    $('#screenPicker').classList.add('hidden');
    applyServerState(await requestServer('switch-channel', { channelId }));
  } catch (error) { toast(error.message, 'error'); }
  finally { state.switchingChannel = false; window.channelVoice?.sync(); renderChannels(state.serverUsers); updateSharingUI(state.isSharing); }
}

async function perform(event, payload) {
  try { await requestServer(event, payload); } catch (error) { toast(error.message, 'error'); }
}
$('#btnServerSettings').addEventListener('click', () => {
  if (state.serverUsers.find(u => u.socketId === socket?.id)?.role !== 'host') return;
  $('#serverSettingsDialog').classList.remove('hidden'); $('#btnCloseServerSettings').focus();
});
$('#btnCloseServerSettings').addEventListener('click', () => { $('#serverSettingsDialog').classList.add('hidden'); $('#btnServerSettings').focus(); });
$('#btnServerPeers').addEventListener('click', () => {
  if (state.serverUsers.find(u => u.socketId === socket?.id)?.role !== 'host') return;
  $('#serverPeersInput').value = state.easytierPeers.join('\n');
  $('#serverPeersError').textContent = '';
  $('#serverPeersDialog').classList.remove('hidden'); $('#serverPeersInput').focus();
});
$('#btnCancelServerPeers').addEventListener('click', () => { $('#serverPeersDialog').classList.add('hidden'); $('#btnServerPeers').focus(); });
$('#serverPeersForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#btnSaveServerPeers').disabled = true;
  try {
    await requestServer('set-server-peers', { peers: normalizePeers($('#serverPeersInput').value) });
    $('#serverPeersDialog').classList.add('hidden'); $('#btnServerPeers').focus();
    toast('节点已保存到服务器，下次连接生效');
  } catch (error) { $('#serverPeersError').textContent = error.message; }
  finally { $('#btnSaveServerPeers').disabled = false; }
});
$('#btnAddChannel').addEventListener('click', () => {
  $('#channelDialog').classList.remove('hidden'); $('#channelNameInput').focus();
});
$('#btnCancelChannel').addEventListener('click', () => { $('#channelDialog').classList.add('hidden'); $('#btnAddChannel').focus(); });

$('#btnServerPassword').addEventListener('click', async () => {
  if (state.serverUsers.find(u => u.socketId === socket?.id)?.role !== 'host') return;
  const button = $('#btnServerPassword'); button.disabled = true;
  try {
    const answer = await requestPassword({ settings: true, connection: socket });
    if (!answer) return;
    await requestServer('set-server-password', answer);
    toast(answer.enabled ? '服务器密码已更新' : '服务器密码已取消', 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#createChannelForm').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#channelNameInput').value.trim();
  if (!name) return toast('请输入频道名称', 'error');
  $('#btnCreateChannel').disabled = true;
  try { await requestServer('create-channel', { name }); $('#channelNameInput').value = ''; $('#channelDialog').classList.add('hidden'); $('#btnAddChannel').focus(); }
  catch (error) { toast(error.message, 'error'); }
  finally { $('#btnCreateChannel').disabled = false; }
});

export function enterRoom(roomId) {
  $('#lobby').classList.remove('active');
  $('#room').classList.add('active');
  $('#channelNameDisplay').textContent = '主频道';
  const serverUrl = $('#serverUrl').value.trim();
  $('#roomServerName').textContent = (() => { try { return new URL(serverUrl).hostname; } catch { return '服务器'; } })();
  $('#roomServerAddress').textContent = serverUrl;
  const icon = state.serverIcon;
  const iconNode = $('#roomServerIcon');
  iconNode.style.backgroundImage = icon ? `url("${icon}")` : '';
  iconNode.classList.toggle('has-image', !!icon);
  iconNode.textContent = icon ? '' : 'S';
  $('#roomUserName').value = localStorage.getItem('userName') || '';
  updateSharingUI(false);
  $('#userCardsView').classList.remove('hidden');
  $('#activeVideoView').classList.add('hidden');
  state.watchingId = null;
}

export async function leaveRoom() {
  if (state.leaving) return;
  state.leaving = true;
  closeContextMenu(); $('#channelDialog').classList.add('hidden');
  $('#serverSettingsDialog').classList.add('hidden');
  $('#serverPeersDialog').classList.add('hidden');
  $('#btnLeave').disabled = true;
  $('#btnLeave').title = '正在清理…';
  $('#btnLeave').textContent = '正在清理…';
  $('#btnRetryCleanup').disabled = true;
  $('#btnConnect').disabled = true;
  stopWatch();
  const voiceStopping = window.channelVoice?.stop();
  const stopping = stopSharing({ reportErrors: false });
  disconnectSignaling();
  roomUsers.clear();
  state.roomId = null; state.channelId = null; state.channels = []; state.serverUsers = [];
  state.virtualIp = null;
  state.activeSharerId = null;
  state.selectedSourceId = null;
  $('#screenPicker').classList.add('hidden');
  $('#serverStatus').className = 'status-dot disconnected';
  try {
    // Start network cleanup even if a previous media stop fails or is pending.
    const results = await Promise.allSettled([
      stopping, Promise.resolve().then(() => window.electronAPI.leaveRuntime()),
      voiceStopping,
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    state.shareCleanupFailed = false;
    state.runtimeCleanupFailed = false;
    $('#runtimeCleanupStatus').textContent = '';
    $('#runtimeCleanupStatus').classList.add('hidden');
    $('#btnRetryCleanup').classList.add('hidden');
  } catch (error) {
    state.runtimeCleanupFailed = true;
    const message = `服务器连接已断开，但本机资源清理未完成：${error.message}`;
    $('#runtimeCleanupStatus').textContent = message;
    $('#runtimeCleanupStatus').classList.remove('hidden');
    $('#btnRetryCleanup').classList.remove('hidden');
    toast(message, 'error');
  } finally {
    state.leaving = false;
    $('#btnLeave').disabled = false;
    $('#btnLeave').title = '断开连接';
    $('#btnLeave').textContent = '×';
    $('#btnRetryCleanup').disabled = false;
    $('#btnConnect').disabled = state.joining || state.runtimeCleanupFailed;
    $('#room').classList.remove('active');
    $('#lobby').classList.add('active');
    updateSharingUI(false);
  }
}
