// ============================================================
// ScreenSh — 房间进出 + 成员列表 + 大厅卡片网格
// ============================================================
import { state, $ } from './shared.js';
import { socket, roomUsers, disconnectSignaling, requestServer, applyServerState } from './signaling.js';
import { toast } from './toast.js';
import { requestPassword } from './password-dialog.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';
import { normalizePeers } from './easytier-peers.mjs';
import { initServerPeerTests } from './server-peer-tests.mjs';
import { decorateInteractionCard } from './interactions.js';
import { MAX_IMAGE_BYTES, isImageData } from './image-data.mjs';
import { readChannelPreferences, saveChannelPreference } from './server-channel-preferences.mjs';
import { applyAvatarThumbnails } from './avatar-thumbnail.mjs';
import { syncLolPing, stopLolPing } from './lolping.js';
import { voiceIcon } from './voice-icons.mjs';
import {
  escapeHtml,
  displayRemoteVideo,
  updateSharingUI,
  stopWatch,
  stopSharing,
  openScreenPicker,
} from './media.js';
// --- 成员列表 + 卡片网格 ---
const channelIconMarkup = icon => `<span class="channel-icon" aria-hidden="true"><span class="channel-default"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M16.5 7.5a6.36 6.36 0 1 0 0 9"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></span>${icon ? `<img src="${escapeHtml(icon)}" alt="" onerror="this.remove()" />` : ''}</span>`;
export function renderCurrentChannel(channel) {
  $('#currentChannelIcon').innerHTML = channel ? channelIconMarkup(channel.icon) : '';
  $('#channelNameDisplay').textContent = channel?.name || '';
}
const roleBadges = {
  host: { label: '服主', path: '<path d="m3 6 4 4 5-6 5 6 4-4-2 12H5L3 6Z"/><path d="M6 21h12"/>' },
  admin: { label: '管理员', path: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>' },
  member: { label: '成员', path: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>' },
};
function roleBadge(role) {
  const item = roleBadges[role] || roleBadges.member;
  return `<span class="member-role role-${roleBadges[role] ? role : 'member'}" title="${item.label}" aria-label="${item.label}" role="img"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.path}</svg></span>`;
}
const memberRank = { host: 2, admin: 1, member: 0 };
const sharingIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>';
function memberActions(user, users, allowDelete = false) {
  const myRole = users.find(u => u.socketId === socket?.id)?.role;
  const actions = [];
  if ((user.memberId || user.socketId) && myRole === 'host' && user.role !== 'host') actions.push({
    label: user.role === 'admin' ? '移除管理员' : '设为管理员',
    run: () => perform('set-admin', { ...(user.socketId ? { socketId: user.socketId } : { memberId: user.memberId }), enabled: user.role !== 'admin' })
  });
  if (memberRank[myRole] > memberRank[user.role]) {
    if (user.socketId) actions.push({ label: '踢出服务器', run: () => perform('kick-member', { socketId: user.socketId }) });
    if (user.socketId && state.channelId && user.channelId === state.channelId) actions.push({ label: user.voiceMuted ? '解除禁言' : '禁言', run: () => perform('set-member-mute', { socketId: user.socketId, muted: !user.voiceMuted }) });
    if (allowDelete && user.memberId) actions.push({ label: '删除成员配置', run: () => perform('delete-member-config', { memberId: user.memberId }) });
  }
  return actions;
}

export function updateUserList(users, allMembers = users) {
  const serverUsers = users;
  const rank = { host: 2, admin: 1, member: 0 };
  const orderedMembers = [...allMembers].sort((a, b) => (rank[b.role] ?? 0) - (rank[a.role] ?? 0) || Number(b.online !== false) - Number(a.online !== false));
  // 侧边栏列表
  const list = $('#userList');
  list.innerHTML = orderedMembers
    .map((u) => {
      const isMe = u.socketId === socket?.id;
      return `
        <li class="${isMe ? 'me' : ''}${u.online === false ? ' member-offline' : ''}" data-member-id="${escapeHtml(u.memberId || '')}">
          <span class="member-avatar default-avatar" aria-hidden="true">👤${u.avatar ? `<img data-avatar-source="${escapeHtml(u.avatar)}" alt="" onerror="this.remove()" />` : ''}</span>
          <span class="member-name">${escapeHtml(u.name)}</span>
          ${roleBadge(u.role)}
        </li>
      `;
    })
    .join('');
  applyAvatarThumbnails(list);

  const myRole = users.find(u => u.socketId === socket?.id)?.role;
  [...list.children].forEach((row, index) => {
    const user = orderedMembers[index];
    row.oncontextmenu = event => showContextMenu(event, memberActions(user, serverUsers, true));
  });
  renderChannels(users);
  users = users.filter(u => state.channelId && u.channelId === state.channelId).sort((a, b) => Number(b.socketId === socket?.id) - Number(a.socketId === socket?.id));
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

    const btnHtml = `<button type="button" class="card-media-button btn-watch" aria-label="观看共享">${sharingIcon}<span>观看共享</span></button>`;

    const displayName = escapeHtml(u.name);

    card.innerHTML = `
      <div class="card-cover"><div class="avatar">👤${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" onerror="this.remove()" />` : ''}</div>
      ${isSharing ? btnHtml : isMe ? `<button type="button" class="card-media-button card-share-button" aria-label="屏幕共享">${sharingIcon}<span>屏幕共享</span></button>` : ''}</div>
      <div class="name">${displayName}</div>
    `;

    // 自己和其他成员都播放实际共享流。
    if (isSharing) {
      card.querySelector('.btn-watch').addEventListener('click', () => {
        displayRemoteVideo(u.socketId);
      });
    }

    cardsView.appendChild(card);
    if(isMe&&!isSharing){const share=card.querySelector('.card-share-button');share.disabled=state.startingShare||state.stoppingShare||state.leaving||state.switchingChannel||state.shareCleanupFailed;share.onclick=()=>openScreenPicker();}
    window.channelVoice?.decorate(card, u, isMe);
    if (isMe && state.channelId) {
      const exit = document.createElement('button'); exit.type = 'button'; exit.id = 'btnLeaveChannel'; exit.className = 'card-exit-channel';
      exit.title = '退出'; exit.setAttribute('aria-label', '退出频道'); exit.disabled = state.switchingChannel || state.leaving;
      exit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 7l5 5-5 5M9 12h11"/></svg>';
      exit.onclick = () => void switchChannel(null);
      let row = card.querySelector('.card-voice-row');
      if (!row) { row = document.createElement('div'); row.className = 'card-voice-row'; card.append(row); }
      row.append(exit);
    }
    decorateInteractionCard(card, u, isMe);
    if (rank[myRole] > rank[u.role]) card.oncontextmenu = event => showContextMenu(event, [{ label: u.voiceMuted ? '解除禁言' : '禁言', run: () => perform('set-member-mute', { socketId: u.socketId, muted: !u.voiceMuted }) }]);
  });
}

// --- 房间进出 ---
function renderChannels(users) {
  const exit = $('#btnLeaveChannel');
  if (exit) exit.disabled = state.switchingChannel || state.leaving;
  const me = users.find(u => u.socketId === socket?.id);
  $('#btnServerSettings').classList.remove('hidden');
  document.querySelectorAll('.server-owner-setting').forEach(node => node.classList.toggle('hidden', me?.role !== 'host'));
  $('#btnServerPassword').classList.toggle('hidden', me?.role !== 'host');
  $('#btnServerPeers').classList.toggle('hidden', me?.role !== 'host');
  $('#btnServerPassword').textContent = state.passwordRequired ? '服务器密码 · 已设置' : '服务器密码';
  const canManage = ['host', 'admin'].includes(me?.role);
  $('#btnAddChannel').classList.toggle('hidden', !me);
  $('#channelTypeInput').disabled = !canManage;
  if (!canManage) $('#channelTypeInput').checked = true;
  if (!canManage && editingChannelId) $('#channelDialog').classList.add('hidden');
  if (!canManage || !state.channels.some(channel => channel.id === bitrateChannelId)) $('#channelBitrateDialog').classList.add('hidden');
  const list = $('#channelList'),scrollTop=list.scrollTop;
  const memberScroll=new Map([...list.querySelectorAll('.channel-section')].map(section=>[section.dataset.channelId,section.querySelector('.channel-members')?.scrollTop||0]));
  list.innerHTML = '';
  for (const channel of state.channels) {
    const section = document.createElement('div');
    section.className = 'channel-section'; section.dataset.channelId = channel.id;
    const button = document.createElement('button');
    button.className = 'btn btn-outline btn-sm channel-button' + (channel.id === state.channelId ? ' active' : '');
    button.innerHTML = `${channelIconMarkup(channel.icon)}<span class="channel-name">${escapeHtml(channel.name)}</span>${channel.passwordRequired ? '<span class="channel-lock" title="需要频道密码" aria-label="频道已设置密码"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></span>' : ''}`;
    if (channel.temporary) {
      const marker = document.createElement('span'); marker.className = 'channel-temporary'; marker.setAttribute('aria-label', '临时频道');
      marker.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h10v4l-5 5 5 5v4H7v-4l5-5-5-5V3zM10 6h4M10 18h4"/></svg>';
      button.insertBefore(marker, button.querySelector('.channel-lock'));
    }
    button.disabled = state.switchingChannel || state.leaving;
    button.onclick = () => switchChannel(channel.id);
    const canManagePassword = me?.role === 'host' || !!me?.profileId && channel.creatorId === me.profileId;
    button.oncontextmenu = event => showContextMenu(event, [...(canManage ? [
      { label: '重命名', run: () => { const current = state.channels.find(item => item.id === channel.id); if (current) openChannelDialog(current, 'rename'); } },
      { label: '设置图标', run: () => openChannelDialog(state.channels.find(item => item.id === channel.id)) },
      { label: '语音码率', run: () => openChannelBitrate(channel.id) },
      ...(channel.id === 'main' ? [] : [{ label: '删除', run: () => perform('delete-channel', { channelId: channel.id }) }]),
    ] : []), ...(canManagePassword ? [{ label: channel.passwordRequired ? '修改或取消密码' : '设置频道密码', run: () => editChannelPassword(channel.id) }] : [])]);
    section.append(button);
    const members = users.filter(u => u.channelId === channel.id)
      .sort((a, b) => (a.channelJoinedOrder ?? 0) - (b.channelJoinedOrder ?? 0));
    if (members.length) {
      const memberList = document.createElement('ul');
      memberList.className = 'channel-members'; memberList.setAttribute('aria-label', `${channel.name}成员`);
      if(members.length>10){memberList.classList.add('channel-members-scrollable');memberList.tabIndex=0;}
      for (const user of members) {
        const row = document.createElement('li');
        row.className = 'channel-member' + (user.socketId === socket?.id ? ' me' : '');
        row.dataset.userId = user.socketId;
        row.innerHTML = `<span class="member-avatar default-avatar" aria-hidden="true">👤${user.avatar ? `<img data-avatar-source="${escapeHtml(user.avatar)}" alt="" onerror="this.remove()" />` : ''}</span><span class="channel-member-name">${escapeHtml(user.name)}</span>`;
        const indicators = document.createElement('span'); indicators.className = 'channel-member-status';
        if (user.voiceMuted || user.microphoneMuted || !user.voiceEnabled) indicators.innerHTML += `<span class="remote-mic-muted" title="${user.voiceMuted ? '已被禁言' : '麦克风已关闭'}" aria-label="${user.voiceMuted ? '已被禁言' : '麦克风已关闭'}">${voiceIcon('mute', true)}</span>`;
        if (user.voiceDeafened) indicators.innerHTML += `<span class="remote-headphones-off" title="已关闭听筒" aria-label="已关闭听筒">${voiceIcon('deafen', true)}</span>`;
        row.append(indicators);
        row.oncontextmenu = event => showContextMenu(event, memberActions(user, users));
        memberList.append(row);
      }
      section.append(memberList);
    }
    list.append(section);
    const memberList=section.querySelector('.channel-members');if(memberList)memberList.scrollTop=memberScroll.get(channel.id)||0;
  }
  list.scrollTop=scrollTop;
  applyAvatarThumbnails(list);
}

export async function switchChannel(channelId) {
  if (state.switchingChannel || state.leaving || channelId === state.channelId || !state.roomId) return;
  state.switchingChannel = true; renderChannels(state.serverUsers); updateSharingUI(state.isSharing);
  try {
    if (channelId !== null) {
      let password;
      while (true) {
        try { await requestServer('check-channel-access', { channelId, password }); break; }
        catch (error) {
          if (!['请输入频道密码', '频道密码错误'].includes(error.message)) throw error;
          const answer = await requestPassword({ channel: true, connection: socket, error: password === undefined ? '' : error.message });
          if (!answer) return;
          password = answer.password;
        }
      }
    }
    stopLolPing();
    if (!await stopSharing()) throw new Error('当前共享未能停止，请重试后再切换频道');
    await window.channelVoice?.stop();
    $('#screenPicker').classList.add('hidden');
    applyServerState(await requestServer('switch-channel', { channelId }));
  } catch (error) { toast(error.message, 'error'); }
  finally { state.switchingChannel = false; window.channelVoice?.sync(); syncLolPing(); renderChannels(state.serverUsers); updateSharingUI(state.isSharing); }
}

async function perform(event, payload) {
  try { await requestServer(event, payload); } catch (error) { toast(error.message, 'error'); }
}
let bitrateChannelId = null;
function openChannelBitrate(channelId) {
  const channel = state.channels.find(item => item.id === channelId);
  if (!channel) return;
  bitrateChannelId = channelId;
  $('#channelBitrateName').textContent = channel.name;
  $('#channelBitrateSelect').value = String(channel.voiceBitrate || 32);
  $('#channelBitrateError').textContent = '';
  $('#channelBitrateDialog').classList.remove('hidden');
  $('#channelBitrateSelect').focus();
}
$('#btnCloseChannelBitrate').onclick = () => $('#channelBitrateDialog').classList.add('hidden');
$('#channelBitrateForm').onsubmit = async event => {
  event.preventDefault();
  const channelId = bitrateChannelId;
  $('#btnSaveChannelBitrate').disabled = true;
  try {
    await requestServer('set-channel-voice-bitrate', { channelId, bitrate: Number($('#channelBitrateSelect').value) });
    $('#channelBitrateDialog').classList.add('hidden');
  } catch (error) { $('#channelBitrateError').textContent = error.message; }
  finally { $('#btnSaveChannelBitrate').disabled = false; }
};
$('#btnServerSettings').addEventListener('click', () => {
  if (!state.roomId) return;
  $('#autoJoinChannelCheckbox').checked = readChannelPreferences(state.roomId).autoJoin;
  $('#serverNameInput').value = state.serverName || '0091 Server';
  $('#serverNameError').textContent = '';
  $('#serverSettingsDialog').classList.remove('hidden'); $('#btnCloseServerSettings').focus();
});
$('#autoJoinChannelCheckbox').onchange = event => {
  if (state.roomId) saveChannelPreference(state.roomId, { autoJoin: event.target.checked });
};
$('#serverNameForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#btnSaveServerName').disabled = true; $('#serverNameError').textContent = '';
  try {
    const result = await requestServer('set-server-name', { name: $('#serverNameInput').value });
    $('#serverNameInput').value = result.serverName;
  } catch (error) { $('#serverNameError').textContent = error.message; }
  finally { $('#btnSaveServerName').disabled = false; }
});
$('#btnCloseServerSettings').addEventListener('click', () => { $('#serverSettingsDialog').classList.add('hidden'); $('#btnServerSettings').focus(); });
const serverPeerTests=initServerPeerTests(window.electronAPI);
$('#btnServerPeers').addEventListener('click', () => {
  if (state.serverUsers.find(u => u.socketId === socket?.id)?.role !== 'host') return;
  $('#serverPeersInput').value = state.easytierPeers.join('\n');
  $('#serverPeersError').textContent = '';
  serverPeerTests.reset();
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
let editingChannelId = null, channelEditMode = 'icon', draftChannelIcon = null, channelIconRevision = 0, channelIconBusy = false;
async function editChannelPassword(channelId) {
  const channel = state.channels.find(item => item.id === channelId);
  if (!channel) return;
  const answer = await requestPassword({ channel: true, settings: true, enabled: !!channel.passwordRequired, connection: socket });
  if (!answer) return;
  try { await requestServer('set-channel-password', { channelId, ...answer }); }
  catch (error) { toast(error.message, 'error'); }
}
function resetChannelPasswordFields() {
  $('#channelPasswordEnabled').checked = false;
  $('#channelCreatePassword').value = $('#channelCreatePasswordConfirm').value = '';
  $('#channelCreatePasswordFields').classList.add('hidden');
}
$('#channelPasswordEnabled').onchange = event => {
  $('#channelCreatePasswordFields').classList.toggle('hidden', !event.target.checked);
  if (!event.target.checked) $('#channelCreatePassword').value = $('#channelCreatePasswordConfirm').value = '';
};
function openChannelDialog(channel = null, mode = 'icon') {
  channelEditMode = mode;
  editingChannelId = channel?.id || null; draftChannelIcon = channel ? undefined : null; channelIconRevision++; channelIconBusy = false;
  const rename = !!channel && mode === 'rename';
  $('#channelDialog .channel-create-options').classList.toggle('hidden', !!channel);
  $('#channelTypeInput').checked = true; resetChannelPasswordFields();
  $('#channelDialogTitle').textContent = rename ? '重命名频道' : channel ? '频道图标' : '创建频道';
  $('#channelNameInput').value = channel?.name || ''; $('#channelNameInput').disabled = !!channel && !rename;
  $('#channelDialog .channel-icon-setting').classList.toggle('hidden', rename);
  $('#channelIconPreview').innerHTML = channelIconMarkup(channel?.icon);
  $('#channelIconInput').value = ''; $('#btnCreateChannel').disabled = false; $('#btnCreateChannel').textContent = rename ? '保存名称' : channel ? '保存图标' : '创建频道';
  $('#channelDialog').classList.remove('hidden'); (channel && !rename ? $('#btnChooseChannelIcon') : $('#channelNameInput')).focus();
}
$('#btnAddChannel').addEventListener('click', () => openChannelDialog());
$('#btnChooseChannelIcon').addEventListener('click', () => $('#channelIconInput').click());
$('#btnResetChannelIcon').addEventListener('click', () => {
  channelIconRevision++; channelIconBusy = false; draftChannelIcon = null;
  $('#channelIconPreview').innerHTML = channelIconMarkup(null); $('#channelIconInput').value = ''; $('#btnCreateChannel').disabled = false;
});
$('#channelIconInput').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const revision = ++channelIconRevision; channelIconBusy = true; $('#btnCreateChannel').disabled = true;
  try {
    if (file.size > MAX_IMAGE_BYTES || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('请选择不大于2MB的 PNG、JPEG、WebP 或 GIF 图片');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
    if (revision !== channelIconRevision || $('#channelDialog').classList.contains('hidden')) return;
    if (!isImageData(data)) throw new Error('图片无效或大于2MB');
    draftChannelIcon = data; $('#channelIconPreview').innerHTML = channelIconMarkup(data);
  } catch (error) { if (revision === channelIconRevision) toast(error.message, 'error'); }
  finally { if (revision === channelIconRevision) { channelIconBusy = false; $('#btnCreateChannel').disabled = false; } }
});
$('#btnCancelChannel').addEventListener('click', () => { resetChannelPasswordFields(); $('#channelDialog').classList.add('hidden'); $('#btnAddChannel').focus(); });

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
  if (channelIconBusy || $('#btnCreateChannel').disabled) return;
  const name = $('#channelNameInput').value.trim();
  if (!name) return toast('请输入频道名称', 'error');
  const passwordEnabled = !editingChannelId && $('#channelPasswordEnabled').checked;
  const password = $('#channelCreatePassword').value;
  if (passwordEnabled && !password.trim()) return toast('请输入频道密码', 'error');
  if (passwordEnabled && password !== $('#channelCreatePasswordConfirm').value) return toast('两次输入的密码不一致', 'error');
  $('#btnCreateChannel').disabled = true;
  try {
    if (editingChannelId && channelEditMode === 'rename') await requestServer('rename-channel', { channelId: editingChannelId, name });
    else if (editingChannelId) { if (draftChannelIcon !== undefined) await requestServer('set-channel-icon', { channelId: editingChannelId, icon: draftChannelIcon }); }
    else await requestServer('create-channel', { name, icon: draftChannelIcon, temporary: $('#channelTypeInput').checked, passwordEnabled, ...(passwordEnabled ? { password } : {}) });
    resetChannelPasswordFields();
    $('#channelNameInput').value = ''; $('#channelDialog').classList.add('hidden'); $('#btnAddChannel').focus();
  }
  catch (error) { toast(error.message, 'error'); }
  finally { $('#btnCreateChannel').disabled = false; }
});

export function enterRoom(roomId) {
  $('#lobby').classList.remove('active');
  $('#room').classList.add('active');
  renderCurrentChannel(null);
  const serverUrl = $('#serverUrl').value.trim();
  $('#roomServerName').textContent = state.serverName || '0091 Server';
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
  closeContextMenu(); resetChannelPasswordFields(); $('#channelDialog').classList.add('hidden'); $('#channelBitrateDialog').classList.add('hidden');
  $('#serverSettingsDialog').classList.add('hidden');
  $('#lolPingDialog')?.classList.add('hidden');
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
  state.serverName = '0091 Server';
  state.virtualIp = null;
  state.noTun = false;
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
    syncLolPing();
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
