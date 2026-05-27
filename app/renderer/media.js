// ============================================================
// ScreenSh — MediaMTX + WHEP/WHIP 调度
// ============================================================
import { state, $, $$, getIceServers } from './shared.js';
import { toast } from './toast.js';
import { socket, roomUsers } from './signaling.js';

let whepPeerConnection = null;

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 修复 1：调用 Electron 接口获取真实系统屏幕，并渲染列表
export async function loadScreenSources() {
  const list = $('#screenList');
  list.innerHTML = '<p style="color:var(--text2);font-size:13px;padding:10px;">获取屏幕列表中...</p>';

  try {
    const screens = await window.electronAPI.getScreens();
    list.innerHTML = '';
    screens.forEach(s => {
      const item = document.createElement('div');
      item.className = 'screen-item';
      item.innerHTML = `<div class="screen-name">📺 ${s.name}</div>`;
      item.onclick = () => {
        $$('.screen-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        state.selectedSourceId = s.id;
        // 选中后显示【确认共享】按钮
        $('#btnConfirmShare').classList.remove('hidden');
      };
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = '<p style="color:var(--danger);font-size:13px;padding:10px;">读取系统显示器失败</p>';
  }
}

// 修复 2：将用户保存的设置一并打包传给底层系统
export async function startScreenCapture() {
  if (state.selectedSourceId === null || state.selectedSourceId === undefined) {
    return toast('请在列表中选中一个要共享的显示器', 'error');
  }

  state.isSharing = true;
  updateSharingUI(true);
  $('#screenPicker').classList.add('hidden'); // 开始后自动收起选择栏

  // 1. 启动本机的 MediaMTX 服务
  window.electronAPI.startMediaMTX();

  // 2. 组装用户设置，传给 OBS
  const config = {
    sourceId: state.selectedSourceId,
    resolution: state.resolution,
    frameRate: state.frameRate,
    maxBitrate: state.maxBitrate,
    shareAudio: state.shareAudio,
    audioBitrate: state.audioBitrate
  };
  window.electronAPI.startOBSWhip(config);

  // 3. 通知其他终端
  socket.emit('start-sharing');
  toast('屏幕共享已开始', 'success');
  displayLocalMock();
}

export function stopSharing() {
  state.isSharing = false;
  state.selectedSourceId = null;
  window.electronAPI.stopOBSWhip();
  window.electronAPI.stopMediaMTX();
  socket.emit('stop-sharing');
  updateSharingUI(false);
  $('#btnStopWatch').click();
  $('#btnConfirmShare').classList.add('hidden');
}

export function updateSharingUI(sharing) {
  if (sharing) {
    $('#btnShare').classList.add('hidden');
    $('#btnStopShare').classList.remove('hidden');
  } else {
    $('#btnShare').classList.remove('hidden');
    $('#btnStopShare').classList.add('hidden');
  }
}

function displayLocalMock() {
  $('#userCardsView').classList.add('hidden');
  $('#activeVideoView').classList.remove('hidden');
  $('#watchingUserName').textContent = '你正在共享屏幕';
  const container = $('#videoContainer');
  container.innerHTML = `<div style="color:var(--text2); display:flex; flex-direction:column; align-items:center;">
    <div style="font-size: 40px; margin-bottom: 20px;">🎬</div>
    <div>底层 OBS 引擎推流正常运作中</div>
    <div style="font-size: 12px; margin-top: 10px; opacity:0.6;">观众将通过 EasyTier 直接连入您的电脑拉流</div>
  </div>`;
}

// 修复 3：补齐被遗忘的 画中画 (PiP) 模式按钮
export async function displayRemoteVideo(targetSocketId) {
  const targetUser = roomUsers.get(targetSocketId);
  if (!targetUser || !targetUser.virtualIp) return toast('无法获取共享者的虚拟局域网 IP', 'error');

  state.watchingId = targetSocketId;
  const targetVip = targetUser.virtualIp;

  const container = $('#videoContainer');
  // 把你的 .pip-bar 结合进去
  container.innerHTML = `
    <video autoplay playsinline controls></video>
    <div style="position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.5); padding:6px 10px; font-size:12px; border-radius: 6px; color: #fff;">
      P2P 隧道源: ${targetVip}
    </div>
    <div class="pip-bar">
      <button id="btnPip">📽 画中画</button>
    </div>
  `;
  const video = container.querySelector('video');

  // 绑定画中画事件
  $('#btnPip').onclick = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      toast('画中画开启失败，可能浏览器限制', 'error');
    }
  };

  try {
    whepPeerConnection = new RTCPeerConnection(getIceServers());
    whepPeerConnection.addTransceiver('video', { direction: 'recvonly' });
    whepPeerConnection.addTransceiver('audio', { direction: 'recvonly' });

    whepPeerConnection.ontrack = (event) => {
      if (video.srcObject !== event.streams[0]) {
        video.srcObject = event.streams[0];
      }
    };

    const offer = await whepPeerConnection.createOffer();
    await whepPeerConnection.setLocalDescription(offer);

    const whepUrl = `http://${targetVip}:8889/live/whep`;
    console.log(`[WHEP] Requesting stream from ${whepUrl}`);

    const response = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    });

    if (!response.ok) throw new Error(`MediaMTX WHEP 响应失败: ${response.status}`);

    const answerSdp = await response.text();
    await whepPeerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  } catch (err) {
    console.error('WHEP 拉流失败:', err);
    toast('拉取 P2P 视频流失败: ' + err.message, 'error');
  }
}

export function stopWatch() {
  if (whepPeerConnection) {
    whepPeerConnection.close();
    whepPeerConnection = null;
  }
  state.watchingId = null;
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => console.log('退出PIP失败'));
  }
  $('#activeVideoView').classList.add('hidden');
  $('#userCardsView').classList.remove('hidden');
  $('#videoContainer').innerHTML = '';
}
