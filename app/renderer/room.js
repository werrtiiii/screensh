// ============================================================
// ScreenSh — 房间进出 + 成员列表 + 大厅卡片网格
// ============================================================
import { state, $ } from './shared.js';
import { socket, roomUsers, disconnectSignaling } from './signaling.js';
import {
  escapeHtml,
  displayRemoteVideo,
  updateSharingUI,
} from './media.js';
// --- 成员列表 + 卡片网格 ---

export function updateUserList(users) {
  // 侧边栏列表
  const list = $('#userList');
  $('#userCount').textContent = users.length;
  list.innerHTML = users
    .map((u) => {
      const isMe = u.socketId === socket?.id;
      const roleText = u.role === 'host' ? '房主' : '成员';
      const shareText = u.isSharing ? ' (共享中)' : '';
      return `
        <li class="${isMe ? 'me' : ''}">
          <span class="user-dot ${u.isSharing ? 'sharer' : 'viewer'}"></span>
          <span>${escapeHtml(u.name)}${isMe ? ' (我)' : ''}</span>
          <span class="user-role">${roleText}${shareText}</span>
        </li>
      `;
    })
    .join('');

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

    const displayName = isMe ? `${escapeHtml(u.name)}（我）` : escapeHtml(u.name);

    card.innerHTML = `
      <div class="avatar">👤</div>
      <div class="name">${displayName}</div>
      ${btnHtml}
    `;

    // 观看别人的共享
    if (isMe && isSharing) {
      card.querySelector('.btn-watch').addEventListener('click', () => {
        state.watchingId = u.socketId;
        $('#userCardsView').classList.add('hidden');
        $('#activeVideoView').classList.remove('hidden');
        $('#watchingUserName').textContent = '你正在通过 OBS 共享屏幕';
        $('#videoContainer').innerHTML = `<div style="color:var(--text2);">[OBS 推流中，观众可通过 EasyTier 访问你的 MediaMTX 节点]</div>`;
      });
    } else if (isSharing && !isMe) {
      card.querySelector('.btn-watch').addEventListener('click', () => {
        $('#userCardsView').classList.add('hidden');
        $('#activeVideoView').classList.remove('hidden');
        $('#watchingUserName').textContent = `正在观看 ${escapeHtml(u.name)} 的共享`;
        displayRemoteVideo(u.socketId);
      });
    }

    cardsView.appendChild(card);
  });
}

// --- 房间进出 ---

export function enterRoom(roomId) {
  $('#lobby').classList.remove('active');
  $('#room').classList.add('active');
  $('#roomIdDisplay').textContent = roomId;
  updateSharingUI(false);
  $('#userCardsView').classList.remove('hidden');
  $('#activeVideoView').classList.add('hidden');
  state.watchingId = null;
}

export function leaveRoom() {
  window.electronAPI.stopEasyTier();
  window.electronAPI.stopOBSWhip();
  window.electronAPI.stopMediaMTX();

  import('./media.js').then(m => m.stopWatch());
  disconnectSignaling();

  state.roomId = null;
  state.virtualIp = null;
  $('#room').classList.remove('active');
  $('#lobby').classList.add('active');
}


// --- 房间号复制按钮监听 ---
const btnCopyRoomId = $('#btnCopyRoomId');
if (btnCopyRoomId) {
  btnCopyRoomId.addEventListener('click', () => {
    if (!state.roomId) return;
    navigator.clipboard.writeText(state.roomId).then(() => {
      const originText = btnCopyRoomId.textContent;
      btnCopyRoomId.textContent = '✅ 已复制';
      btnCopyRoomId.classList.add('btn-primary');
      btnCopyRoomId.classList.remove('btn-outline');

      setTimeout(() => {
        btnCopyRoomId.textContent = originText;
        btnCopyRoomId.classList.remove('btn-primary');
        btnCopyRoomId.classList.add('btn-outline');
      }, 2000);
    }).catch(err => {
      console.error('复制失败:', err);
      toast('复制失败，请手动选中复制', 'error');
    });
  });
}
