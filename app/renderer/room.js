// ============================================================
// ScreenSh — 房间进出 + 成员列表 + 大厅卡片网格
// ============================================================
import { state, $ } from './shared.js';
import { socket, peerConnections, removeAllPeerConnections, disconnectSignaling } from './signaling.js';
import {
  escapeHtml,
  displayLocalVideo,
  displayRemoteVideo,
  loadScreenSources,
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

    // 自己共享时：展示本地预览
    if (isMe && isSharing) {
      card.querySelector('.btn-watch').addEventListener('click', () => {
        state.watchingId = u.socketId;
        $('#userCardsView').classList.add('hidden');
        $('#activeVideoView').classList.remove('hidden');
        $('#watchingUserName').textContent = '你正在共享屏幕';
        displayLocalVideo(state.localStream);
      });
    }

    // 观看别人的共享
    if (!isMe && isSharing) {
      card.querySelector('.btn-watch').addEventListener('click', async () => {
        if (state.watchingId && state.watchingId !== u.socketId) {
          socket.emit('view-stopped', { target: state.watchingId });
          if (window.debugInterval) {
            clearInterval(window.debugInterval);
            window.debugInterval = null;
          }
        }
        state.watchingId = u.socketId;
        $('#userCardsView').classList.add('hidden');
        $('#activeVideoView').classList.remove('hidden');
        $('#watchingUserName').textContent = `正在观看 ${escapeHtml(u.name)} 的共享`;

        const pc = peerConnections[u.socketId];
        let hasExistingStream = false;

        if (pc) {
          const receivers = pc.getReceivers();
          const videoReceivers = receivers.filter(r => r.track && r.track.kind === 'video');
          const activeReceiver = videoReceivers.reverse().find(r => r.track.readyState === 'live');

          if (activeReceiver) {
            hasExistingStream = true;

            const tracks = [activeReceiver.track];
            const audioReceivers = receivers.filter(r => r.track && r.track.kind === 'audio');
            const activeAudioReceiver = audioReceivers.reverse().find(r => r.track.readyState === 'live');
            
            if (activeAudioReceiver) {
              tracks.push(activeAudioReceiver.track);
            }
            
            const stream = new MediaStream(tracks);
            const handleUnmute = () => {
              if (state.watchingId === u.socketId) {
                const currentTracks = [];
                const vRecv = pc.getReceivers().slice().reverse().find(r => r.track && r.track.kind === 'video' && r.track.readyState === 'live');
                const aRecv = pc.getReceivers().slice().reverse().find(r => r.track && r.track.kind === 'audio' && r.track.readyState === 'live');
                if (vRecv) currentTracks.push(vRecv.track);
                if (aRecv) currentTracks.push(aRecv.track);
                
                displayRemoteVideo(u.socketId, new MediaStream(currentTracks));
              }
            };
            if (activeReceiver && activeReceiver.track.muted) {
              activeReceiver.track.onunmute = handleUnmute;
            }
            if (activeAudioReceiver && activeAudioReceiver.track.muted) {
              activeAudioReceiver.track.onunmute = handleUnmute;
            }
            if ((!activeReceiver || !activeReceiver.track.muted) && 
                (!activeAudioReceiver || !activeAudioReceiver.track.muted)) {
              displayRemoteVideo(u.socketId, stream);
            }
          }
        }

        if (!hasExistingStream) {
          $('#videoContainer').innerHTML = `
            <div class="placeholder-icon">⏳</div>
            <p style="margin-top: 10px; color: var(--text2);">正在请求画面...</p>
          `;
        }
        socket.emit('request-view', { target: u.socketId });
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
  loadScreenSources();
  $('#userCardsView').classList.remove('hidden');
  $('#activeVideoView').classList.add('hidden');
  state.watchingId = null;
}

export function leaveRoom() {
  removeAllPeerConnections();

  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
    state.isSharing = false;
  }

  $('#videoContainer').innerHTML = '';
  $('#userCardsView').classList.remove('hidden');
  $('#activeVideoView').classList.add('hidden');

  disconnectSignaling();

  state.roomId = null;
  state.watchingId = null;
  state.activeSharerId = null;
  $('#room').classList.remove('active');
  $('#lobby').classList.add('active');
  $('#serverStatus').className = 'status-dot disconnected';
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