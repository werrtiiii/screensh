// ============================================================
// ScreenSh — 入口文件：UI 事件绑定
// ============================================================
import { state, $, $$ } from './shared.js';
import { toast } from './toast.js';
import { socket, connectServer } from './signaling.js';
import { loadScreenSources, startScreenCapture, stopSharing } from './media.js';
import { leaveRoom } from './room.js';

// --- 初始化主题---
function initTheme() {
  const savedTheme = localStorage.getItem('app-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  // 同步到设置栏的下拉框 UI
  const themeSelect = $('#themeSelect');
  if (themeSelect) themeSelect.value = savedTheme;
}

// 绑定下拉项的 change 监听
$('#themeSelect').addEventListener('change', (e) => {
  const newTheme = e.target.value;
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('app-theme', newTheme);
  toast(`主题已切换`, 'success');
});

// 执行初始化
initTheme();

// --- 创建/加入 标签页切换 ---
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    $(`#panel-${target}`).classList.add('active');
  });
});

// --- 随机生成房间号 ---
$('#btnRandom').addEventListener('click', () => {
  const id = Math.random().toString(36).substring(2, 8).toUpperCase();
  $('#createRoomId').value = id;
});

// --- 创建房间 ---
$('#btnCreate').addEventListener('click', async () => {
  const roomId = $('#createRoomId').value.trim();
  const userName = $('#userName').value.trim() || '匿名用户';
  if (!roomId) return toast('请输入房间号', 'error');

  toast('正在建立 EasyTier 虚拟局域网...', 'success');
  const vip = await window.electronAPI.startEasyTier(roomId);
  state.virtualIp = vip;

  connectServer();
  if (socket.connected) {
    socket.emit('create-room', { roomId, userName, virtualIp: vip });
  } else {
    socket.once('connect', () => socket.emit('create-room', { roomId, userName, virtualIp: vip }));
  }
});

// --- 加入房间 ---
$('#btnJoin').addEventListener('click', async () => {
  const roomId = $('#joinRoomId').value.trim();
  const userName = $('#userName').value.trim() || '匿名用户';
  if (!roomId) return toast('请输入房间号', 'error');

  toast('正在接入 EasyTier 虚拟局域网...', 'success');
  const vip = await window.electronAPI.startEasyTier(roomId);
  state.virtualIp = vip;

  connectServer();
  if (socket.connected) {
    socket.emit('join-room', { roomId, userName, virtualIp: vip });
  } else {
    socket.once('connect', () => socket.emit('join-room', { roomId, userName, virtualIp: vip }));
  }
});

// --- 离开房间 ---
$('#btnLeave').addEventListener('click', leaveRoom);

// --- 共享屏幕：展开屏幕源选择面板 ---
$('#btnShare').addEventListener('click', () => {
  $('#screenPicker').classList.remove('hidden');
  loadScreenSources();
});

// --- 收起屏幕源选择面板 ---
$('#btnCancelPicker').addEventListener('click', () => {
  $('#screenPicker').classList.add('hidden');
  state.selectedSourceId = null;
  $$('.screen-item').forEach((el) => el.classList.remove('selected'));
  $('#btnConfirmShare').classList.add('hidden');
});

// --- 确认开始共享 ---
$('#btnConfirmShare').addEventListener('click', startScreenCapture);

// --- 停止共享 ---
$('#btnStopShare').addEventListener('click', stopSharing);

// --- 返回大厅 / 取消观看 ---
$('#btnStopWatch').addEventListener('click', () => {
  if (state.watchingId) {
    socket.emit('stop-viewing', { target: state.watchingId });
  }
  state.watchingId = null;
  $('#activeVideoView').classList.add('hidden');
  $('#userCardsView').classList.remove('hidden');

  const container = $('#videoContainer');
  const video = container.querySelector('video');
  if (video) video.srcObject = null;
  container.innerHTML = '';
});

// --- 信令服务器连通性检测 ---
function testServerConnection() {
  const url = $('#serverUrl').value.trim() || 'http://localhost:3000';
  const testSocket = io(url, { transports: ['websocket', 'polling'], timeout: 5_000 });

  $('#btnTestServer').textContent = '检测中...';
  $('#btnTestServer').disabled = true;

  testSocket.on('connect', () => {
    $('#serverStatus').className = 'status-dot connected';
    testSocket.disconnect();
    $('#btnTestServer').textContent = '检测';
    $('#btnTestServer').disabled = false;
  });

  testSocket.on('connect_error', () => {
    $('#serverStatus').className = 'status-dot disconnected';
    toast('无法连接到信令服务器', 'error');
    testSocket.disconnect();
    $('#btnTestServer').textContent = '检测';
    $('#btnTestServer').disabled = false;
  });

  setTimeout(() => {
    if (testSocket.disconnected) return;
    testSocket.disconnect();
    $('#btnTestServer').textContent = '检测';
    $('#btnTestServer').disabled = false;
  }, 6_000);
}

$('#btnTestServer').addEventListener('click', testServerConnection);

// 启动时自动检测一次
testServerConnection();

// --- 回车键快捷提交 ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if ($('#lobby').classList.contains('active')) {
      const activePanel = document.querySelector('.tab-panel.active');
      if (activePanel?.id === 'panel-create') {
        $('#btnCreate').click();
      } else {
        $('#btnJoin').click();
      }
    }
  }
});

// --- 窗口关闭前清理 ---
window.addEventListener('beforeunload', () => {
  leaveRoom();
});

// --- 设置面板与编码方式逻辑 ---
function initSettings() {
  const select = $('#videoCodecSelect');
  const capabilities = RTCRtpSender.getCapabilities('video');

  if (capabilities && capabilities.codecs) {
    const uniqueCodecs = new Map();
    capabilities.codecs.forEach(codec => {
      const mime = codec.mimeType.toLowerCase();
      if (mime.includes('rtx') || mime.includes('red') || mime.includes('ulpfec')) return;
      const name = codec.mimeType.split('/')[1].toUpperCase();
      const fmtp = codec.sdpFmtpLine ? codec.sdpFmtpLine : '';
      const value = `${mime}|${fmtp}`;
      if (!uniqueCodecs.has(value)) {
        let label = name;
        if (fmtp) label += ` (${fmtp})`;
        uniqueCodecs.set(value, { label, value });
      }
    });
    uniqueCodecs.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
  }

  // 加载持久化数据，若无则使用 shared.js 中的默认值
  state.preferredCodec = localStorage.getItem('preferredCodec') || '';
  state.resolution = localStorage.getItem('resolution') || state.resolution;
  state.frameRate = parseInt(localStorage.getItem('frameRate')) || state.frameRate;
  state.maxBitrate = localStorage.getItem('maxBitrate') !== null
                     ? parseInt(localStorage.getItem('maxBitrate'))
                     : state.maxBitrate;
  state.shareAudio = localStorage.getItem('shareAudio') === 'true';
  state.audioBitrate = parseInt(localStorage.getItem('audioBitrate')) || state.audioBitrate;
  state.stunServer = localStorage.getItem('stunServer') !== null ? localStorage.getItem('stunServer') : state.stunServer;
  state.turnServer = localStorage.getItem('turnServer') !== null ? localStorage.getItem('turnServer') : state.turnServer;

  // 将状态映射到 UI
  select.value = state.preferredCodec;
  $('#resolutionSelect').value = state.resolution;
  $('#frameRateSelect').value = state.frameRate;
  const bitrateInput = $('#bitrateInput');
  const autoBitrateCheckbox = $('#autoBitrateCheckbox');

  if (state.maxBitrate === 0) {
    autoBitrateCheckbox.checked = true;
    bitrateInput.disabled = true;
    bitrateInput.value = 1500;
  } else {
    autoBitrateCheckbox.checked = false;
    bitrateInput.disabled = false;
    bitrateInput.value = state.maxBitrate;
  }

  autoBitrateCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      bitrateInput.disabled = true;
      state.maxBitrate = 0;
      localStorage.setItem('maxBitrate', 0);
      toast('已开启自动码率，将由浏览器动态调节');
    } else {
      bitrateInput.disabled = false;
      state.maxBitrate = parseInt(bitrateInput.value) || 1500;
      localStorage.setItem('maxBitrate', state.maxBitrate);
      toast(`最大码率限制已恢复为 ${state.maxBitrate} kbps`);
    }
  });

  $('#bitrateInput').addEventListener('change', (e) => {
    if (autoBitrateCheckbox.checked) return;
    let val = parseInt(e.target.value);
    if (val > 10000) val = 10000;
    if (val < 100) val = 100;
    e.target.value = val;
    state.maxBitrate = val;
    localStorage.setItem('maxBitrate', state.maxBitrate);
    toast('最大码率已更新，将在下次共享时生效');
  });

  function autoAdjustBitrate() {
    let baseBitrate = 1500;
    switch (state.resolution) {
      case 'auto':
      case '1920x1080': baseBitrate = 3000; break;
      case '1280x720': baseBitrate = 1500; break;
      case '854x480': baseBitrate = 800; break;
    }
    let recommendedBitrate = baseBitrate;
    if (state.frameRate === 60) {
      recommendedBitrate = Math.floor(baseBitrate * 2);
    } else if (state.frameRate === 15) {
      recommendedBitrate = Math.floor(baseBitrate * 0.5);
    }

    $('#bitrateInput').value = recommendedBitrate;

    if (!autoBitrateCheckbox.checked) {
      state.maxBitrate = recommendedBitrate;
      localStorage.setItem('maxBitrate', recommendedBitrate);
      toast(`分辨率/帧率已更新，码率已自动适配为 ${state.maxBitrate} kbps`);
    } else {
      toast('分辨率/帧率已更新，当前码率为自动控制');
    }
  }

  $('#resolutionSelect').addEventListener('change', (e) => {
    state.resolution = e.target.value;
    localStorage.setItem('resolution', state.resolution);
    autoAdjustBitrate();
  });

  $('#frameRateSelect').addEventListener('change', (e) => {
    state.frameRate = parseInt(e.target.value);
    localStorage.setItem('frameRate', state.frameRate);
    autoAdjustBitrate();
  });

  $('#audioBitrateSelect').value = state.audioBitrate;
  $('#stunInput').value = state.stunServer;
  $('#turnInput').value = state.turnServer;
  $('#shareAudioCheckbox').checked = state.shareAudio;

  // 监听所有变化并持久化
  select.addEventListener('change', (e) => {
    state.preferredCodec = e.target.value;
    localStorage.setItem('preferredCodec', state.preferredCodec);
    toast('视频编码已更新，将在下次共享时生效');
  });

  $('#shareAudioCheckbox').addEventListener('change', (e) => {
    state.shareAudio = e.target.checked;
    localStorage.setItem('shareAudio', state.shareAudio);
    toast('音频共享设置已更新，将在下次共享时生效');
  });

  $('#audioBitrateSelect').addEventListener('change', (e) => {
    state.audioBitrate = parseInt(e.target.value);
    localStorage.setItem('audioBitrate', state.audioBitrate);
    toast('音频码率已更新，将在下次共享时生效');
  });

  $('#stunInput').addEventListener('input', (e) => {
    state.stunServer = e.target.value.trim();
    localStorage.setItem('stunServer', state.stunServer);
    $('#stunStatus').className = 'status-dot'; 
  });

  $('#turnInput').addEventListener('input', (e) => {
    state.turnServer = e.target.value.trim();
    localStorage.setItem('turnServer', state.turnServer);
    $('#turnStatus').className = 'status-dot'; 
  });
}

initSettings();

// --- WebRTC STUN/TURN 连通性检测逻辑 ---
async function testIceServer(type) {
  const isStun = type === 'stun';
  const inputEl = isStun ? $('#stunInput') : $('#turnInput');
  const btnEl = isStun ? $('#btnTestStun') : $('#btnTestTurn');
  const statusEl = isStun ? $('#stunStatus') : $('#turnStatus');
  const val = inputEl.value.trim();

  if (!val) {
    toast(`请先填写 ${type.toUpperCase()} 服务器地址`, 'error');
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = '测试中..';
  statusEl.className = 'status-dot';

  let iceServers = [];
  if (isStun) {
    iceServers.push({ urls: val });
  } else {
    const parts = val.split('|');
    iceServers.push({
      urls: parts[0],
      username: parts[1] || '',
      credential: parts[2] || ''
    });
  }

  const pc = new RTCPeerConnection({ iceServers });
  pc.createDataChannel('test'); 

  let isSuccess = false;
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      if (isStun && event.candidate.type === 'srflx') isSuccess = true;
      if (!isStun && event.candidate.type === 'relay') isSuccess = true;
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    setTimeout(() => {
      pc.close();
      if (isSuccess) {
        statusEl.className = 'status-dot connected';
        toast(`${type.toUpperCase()} 服务器可用！`, 'success');
      } else {
        statusEl.className = 'status-dot disconnected';
        toast(`${type.toUpperCase()} 服务器无法连通或无效`, 'error');
      }
      btnEl.disabled = false;
      btnEl.textContent = '检测';
    }, 3500);

  } catch (err) {
    pc.close();
    statusEl.className = 'status-dot disconnected';
    btnEl.disabled = false;
    btnEl.textContent = '检测';
    toast('检测配置错误: ' + err.message, 'error');
  }
}

$('#btnTestStun').addEventListener('click', () => testIceServer('stun'));
$('#btnTestTurn').addEventListener('click', () => testIceServer('turn'));

// ============================================================
// 窗口控制逻辑 (自定义标题栏)
// ============================================================
const btnMinWindow = document.getElementById('btnMinWindow');
const btnMaxWindow = document.getElementById('btnMaxWindow');
const btnCloseWindow = document.getElementById('btnCloseWindow');

if (btnMinWindow) {
  btnMinWindow.addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });
}
if (btnMaxWindow) {
  btnMaxWindow.addEventListener('click', () => {
    window.electronAPI.maximizeWindow();
  });
}
if (btnCloseWindow) {
  btnCloseWindow.addEventListener('click', () => {
    window.electronAPI.closeWindow();
  });
}
const btnSettings = $('#btnSettings');          // 大厅设置按钮
const btnRoomSettings = $('#btnRoomSettings');  // 房间内设置按钮
const settingsModal = $('#settingsModal');      // 弹窗本体
const btnCloseSettings = $('#btnCloseSettings');// 关闭按钮

if (settingsModal && btnCloseSettings) {
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      $$('.setting-codec').forEach(el => el.style.display = '');
      $$('.setting-server').forEach(el => el.style.display = '');
      $$('.setting-theme').forEach(el => el.style.display = '');
      $$('.setting-room').forEach(el => el.style.display = 'none');
      settingsModal.classList.remove('hidden');
    });
  }
  if (btnRoomSettings) {
    btnRoomSettings.addEventListener('click', () => {
      $$('.setting-codec').forEach(el => el.style.display = 'none');
      $$('.setting-server').forEach(el => el.style.display = 'none');
      $$('.setting-theme').forEach(el => el.style.display = 'none');
      $$('.setting-room').forEach(el => el.style.display = '');
      settingsModal.classList.remove('hidden');
    });
  }
  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });
}