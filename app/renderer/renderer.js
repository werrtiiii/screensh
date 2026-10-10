// ============================================================
// ScreenSh — 入口文件：UI 事件绑定
// ============================================================
import { state, $, $$ } from './shared.js';
import { toast } from './toast.js';
import { socket, connectServer } from './signaling.js';
import { loadScreenSources, startScreenCapture, stopSharing, stopWatch } from './media.js';
import { leaveRoom } from './room.js';
import { DEFAULT_PEER, normalizePeers } from './easytier-peers.mjs';

const peerInput = $('#easytierPeers');
peerInput.value = localStorage.getItem('easytierPeers') ?? DEFAULT_PEER;
function savePeers() {
  try {
    const peers = normalizePeers(peerInput.value);
    localStorage.setItem('easytierPeers', peerInput.value.trim());
    $('#easytierPeersError').textContent = '';
    return peers;
  } catch (error) {
    $('#easytierPeersError').textContent = error.message;
    throw error;
  }
}
peerInput.addEventListener('input', () => { try { savePeers(); } catch {} });

$('#btnTestPeer').addEventListener('click', async () => {
  const button = $('#btnTestPeer'), input = $('#peerTestInput'), result = $('#peerTestResult');
  try {
    const peers = normalizePeers(input.value);
    if (peers.length !== 1) throw new Error('每次只能测试一个节点');
    button.disabled = true; input.disabled = true; button.textContent = '测试中…';
    result.style.color = 'var(--text2)'; result.textContent = '正在连接节点…';
    const tested = await window.electronAPI.testEasyTierPeer(peers[0]);
    result.style.color = 'var(--green, #16a34a)';
    result.textContent = `握手成功 · ${(tested.elapsedMs / 1000).toFixed(1)} 秒`;
  } catch (error) {
    result.style.color = 'var(--danger)';
    result.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  } finally {
    button.disabled = false; input.disabled = false; button.textContent = '测试';
  }
});
$('#peerTestInput').addEventListener('input', () => { $('#peerTestResult').textContent = ''; });
$('#peerTestInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); $('#btnTestPeer').click(); }
});

// --- 初始化主题---
function initTheme() {
  const savedTheme = localStorage.getItem('app-theme') || 'light';
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

// Serialize joining and wait for both the network and the server acknowledgement.
async function joinRoom(creating) {
  if (state.joining || state.leaving || state.roomId) return;
  const roomId = $(creating ? '#createRoomId' : '#joinRoomId').value.trim();
  const userName = $('#userName').value.trim() || '匿名用户';
  if (!roomId) return toast('请输入房间号', 'error');
  state.joining = true; $('#btnCreate').disabled = $('#btnJoin').disabled = true;
  try {
    toast('正在准备网络连接...');
    state.virtualIp = await window.electronAPI.startEasyTier(roomId, savePeers());
    const connection = connectServer();
    await new Promise((resolve, reject) => {
      const successEvent = creating ? 'room-created' : 'room-joined';
      const timer = setTimeout(() => finish(new Error('加入房间超时')), 12000);
      const finish = error => {
        clearTimeout(timer); connection.off(successEvent, success); connection.off('error', failed);
        connection.off('connect_error', failed); connection.off('connect', connected); connection.off('disconnect', disconnected);
        error ? reject(error) : resolve();
      };
      const success = () => finish();
      const failed = error => finish(new Error(error.message || '连接失败'));
      const disconnected = () => finish(new Error('连接已断开'));
      const connected = () => connection.emit(creating ? 'create-room' : 'join-room', { roomId, userName, virtualIp: state.virtualIp });
      connection.once(successEvent, success); connection.once('error', failed);
      connection.once('connect_error', failed); connection.once('disconnect', disconnected);
      if (connection.connected) connected(); else connection.once('connect', connected);
    });
  } catch (error) { toast(error.message, 'error'); await leaveRoom(); }
  finally { state.joining = false; $('#btnCreate').disabled = $('#btnJoin').disabled = false; }
}
$('#btnCreate').addEventListener('click', () => joinRoom(true));
$('#btnJoin').addEventListener('click', () => joinRoom(false));

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
$('#btnStopWatch').addEventListener('click', stopWatch);

// --- 信令服务器连通性检测 ---
function testServerConnection() {
  const url = $('#serverUrl').value.trim() || 'https://sh.rn1.me';
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
    testSocket.disconnect();
    $('#btnTestServer').textContent = '检测';
    $('#btnTestServer').disabled = false;
  }, 6_000);
}

$('#btnTestServer').addEventListener('click', testServerConnection);

$('#serverUrl').value = localStorage.getItem('serverUrl') || 'https://sh.rn1.me';
$('#serverUrl').addEventListener('change', () => localStorage.setItem('serverUrl', $('#serverUrl').value.trim()));
window.electronAPI.onRuntimeError(async message => { toast(message, 'error'); await leaveRoom(); });
// 启动时自动检测一次
testServerConnection();

// --- 回车键快捷提交 ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && settingsModal.classList.contains('hidden')) {
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
  select.innerHTML = '<option value="h264">H.264</option>';
  select.disabled = true;
  // 加载持久化数据，若无则使用 shared.js 中的默认值
  state.preferredCodec = 'h264';
  state.autoPreview = localStorage.getItem('autoPreview') !== 'false';
  $('#autoPreviewCheckbox').checked = state.autoPreview;
  $('#autoPreviewCheckbox').addEventListener('change', e => {
    state.autoPreview = e.target.checked;
    localStorage.setItem('autoPreview', state.autoPreview);
  });
  const savedEncoder = localStorage.getItem('videoEncoder');
  state.videoEncoder = ['x264', 'nvenc', 'amf'].includes(savedEncoder) ? savedEncoder : 'x264';
  $('#videoEncoderSelect').value = state.videoEncoder;
  $('#videoEncoderSelect').addEventListener('change', e => {
    state.videoEncoder = e.target.value;
    localStorage.setItem('videoEncoder', state.videoEncoder);
    toast('编码器已保存，重新共享后生效');
  });
  state.resolution = localStorage.getItem('resolution') || state.resolution;
  const savedCaptureMethod = localStorage.getItem('captureMethod');
  state.captureMethod = ['auto', 'wgc', 'dxgi'].includes(savedCaptureMethod) ? savedCaptureMethod : 'auto';
  $('#captureMethodSelect').value = state.captureMethod;
  $('#captureMethodSelect').addEventListener('change', e => {
    state.captureMethod = e.target.value;
    localStorage.setItem('captureMethod', state.captureMethod);
    toast('整屏采集方式已保存，下次开始共享时生效');
  });
  state.frameRate = parseInt(localStorage.getItem('frameRate')) || state.frameRate;
  state.maxBitrate = localStorage.getItem('maxBitrate') !== null
                     ? parseInt(localStorage.getItem('maxBitrate'))
                     : state.maxBitrate;
  state.shareAudio = localStorage.getItem('shareAudio') === 'true';
  state.audioBitrate = parseInt(localStorage.getItem('audioBitrate')) || state.audioBitrate;
  if (!['auto', '1920x1080', '1280x720', '854x480'].includes(state.resolution)) state.resolution = '1280x720';
  if (![15, 30, 60].includes(state.frameRate)) state.frameRate = 30;
  if (!Number.isInteger(state.maxBitrate) || (state.maxBitrate !== 0 && (state.maxBitrate < 100 || state.maxBitrate > 10000))) state.maxBitrate = 1500;
  if (![32, 64, 128, 256].includes(state.audioBitrate)) state.audioBitrate = 128;

  // 将状态映射到 UI
  select.value = state.preferredCodec;
  $('#resolutionSelect').value = state.resolution;
  $('#frameRateSelect').value = state.frameRate;
  const bitrateInput = $('#bitrateInput');
  const autoBitrateCheckbox = $('#autoBitrateCheckbox');

  if (state.maxBitrate === 0) {
    autoBitrateCheckbox.checked = true;
    bitrateInput.disabled = true;
    bitrateInput.value = '';
    bitrateInput.placeholder = '共享时按实际分辨率和帧率计算';
  } else {
    autoBitrateCheckbox.checked = false;
    bitrateInput.disabled = false;
    bitrateInput.value = state.maxBitrate;
  }

  autoBitrateCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      bitrateInput.disabled = true;
      bitrateInput.value = '';
      bitrateInput.placeholder = '共享时按实际分辨率和帧率计算';
      state.maxBitrate = 0;
      localStorage.setItem('maxBitrate', 0);
      toast('已开启推荐码率，将按分辨率和帧率计算');
    } else {
      bitrateInput.disabled = false;
      state.maxBitrate = parseInt(bitrateInput.value) || 1500;
      bitrateInput.value = state.maxBitrate;
      localStorage.setItem('maxBitrate', state.maxBitrate);
      toast(`目标码率已设为 ${state.maxBitrate} kbps`);
    }
  });

  $('#bitrateInput').addEventListener('change', (e) => {
    if (autoBitrateCheckbox.checked) return;
    let val = parseInt(e.target.value);
    if (!Number.isFinite(val)) val = 1500;
    if (val > 10000) val = 10000;
    if (val < 100) val = 100;
    e.target.value = val;
    state.maxBitrate = val;
    localStorage.setItem('maxBitrate', state.maxBitrate);
    toast('目标码率已更新，将在下次共享时生效');
  });

  function autoAdjustBitrate() {
    toast('分辨率/帧率已更新，重新共享后生效；手动码率保持不变');
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

}

initSettings();

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

// Help remains accessible by mouse, click, or keyboard without toggling a setting.
$$('.help-tip').forEach(tip => {
  tip.tabIndex = 0;
  tip.setAttribute('role', 'note');
  tip.setAttribute('aria-label', tip.dataset.tooltip);
  tip.addEventListener('click', event => { event.preventDefault(); tip.focus(); });
  tip.addEventListener('keydown', event => {
    if (event.key === 'Escape') tip.blur();
    if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
  });
});

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


