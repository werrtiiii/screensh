// ============================================================
// ScreenSh — 入口文件：UI 事件绑定
// ============================================================
import { state, $, $$ } from './shared.js';
import { toast } from './toast.js';
import { socket, connectServer, requestServer, applyServerState } from './signaling.js';
import { loadScreenSources, startScreenCapture, stopSharing, stopWatch } from './media.js';
import { leaveRoom, enterRoom } from './room.js';
import { normalizePeers } from './easytier-peers.mjs';
import { requestPassword } from './password-dialog.js';

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

// A server has one permanent room; its stable ID also names the EasyTier network.
async function joinServer() {
  if (state.joining || state.leaving || state.runtimeCleanupFailed || state.roomId) return;
  const userName = $('#userName').value.trim();
  if (!userName) { $('#userName').focus(); return toast('请输入名称', 'error'); }
  if (userName.length > 20) return toast('名称最多20个字符', 'error');
  let serverUrl;
  try {
    const parsed = new URL($('#serverUrl').value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    serverUrl = parsed.origin;
  } catch { return toast('请输入有效的 HTTP 或 HTTPS 服务器地址，不要附加路径', 'error'); }
  $('#serverUrl').value = serverUrl;
  localStorage.setItem('userName', userName); localStorage.setItem('serverUrl', serverUrl);
  state.joining = true; $('#btnConnect').disabled = true; $('#btnConnect').textContent = '连接中…';
  try {
    const connection = connectServer();
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); connection.off('connect', ready); connection.off('connect_error', failed); error ? reject(error) : resolve(); };
      const ready = () => finish(), failed = error => finish(new Error(error.message || '连接失败'));
      const timer = setTimeout(() => finish(new Error('连接服务器超时')), 12000);
      connection.once('connect', ready); connection.once('connect_error', failed);
      if (connection.connected) ready();
    });
    const info = await requestServer('server-info', {}, connection);
    if (info.protocol !== 2 || !/^[a-f0-9-]{36}$/.test(info.serverId)) throw new Error('请升级为支持频道的服务器');
    let password = '';
    if (info.passwordRequired) {
      const answer = await requestPassword({ connection });
      if (!answer) { await leaveRoom(); return; }
      password = answer.password;
    }
    const access = await requestServer('check-access', { userName, password }, connection);
    if (!Array.isArray(access.easytierPeers)) throw new Error('请更新服务端以使用统一组网节点');
    const easytierPeers = normalizePeers(access.easytierPeers);
    const identityKey = 'serverIdentity:' + serverUrl + ':' + info.serverId;
    let identity = localStorage.getItem(identityKey);
    if (!/^[a-f0-9]{64}$/.test(identity || '')) {
      identity = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(identityKey, identity);
    }
    toast('正在准备网络连接…');
    state.virtualIp = await window.electronAPI.startEasyTier(info.serverId, easytierPeers);
    const joined = await requestServer('join-server', { userName, identity, password, easytierPeers, virtualIp: state.virtualIp }, connection);
    if (!connection.connected) throw new Error('连接已断开，请重试');
    state.roomId = info.serverId; state.userName = userName;
    enterRoom(info.serverId); applyServerState(joined);
  } catch (error) { toast(error.message, 'error'); await leaveRoom(); }
  finally { state.joining = false; $('#btnConnect').disabled = state.leaving || state.runtimeCleanupFailed; $('#btnConnect').textContent = '连接服务器'; }
}
$('#btnConnect').addEventListener('click', joinServer);

// --- 离开房间 ---
$('#btnLeave').addEventListener('click', leaveRoom);
$('#btnRetryCleanup').addEventListener('click', leaveRoom);

// --- 共享屏幕：展开屏幕源选择面板 ---
$('#btnShare').addEventListener('click', () => {
  $('#screenPicker').classList.remove('hidden');
  $('#btnCancelPicker').focus();
  loadScreenSources();
});

// --- 收起屏幕源选择面板 ---
$('#btnCancelPicker').addEventListener('click', () => {
  $('#screenPicker').classList.add('hidden');
  state.selectedSourceId = null;
  $$('.screen-item').forEach((el) => el.classList.remove('selected'));
  $('#btnConfirmShare').classList.add('hidden');
});

for (const [id, close] of [['screenPicker', 'btnCancelPicker'], ['channelDialog', 'btnCancelChannel'], ['serverPeersDialog', 'btnCancelServerPeers'], ['serverSettingsDialog', 'btnCloseServerSettings']]) {
  const modal = $('#' + id);
  modal.addEventListener('click', event => { if (event.target === modal) $('#' + close).click(); });
  modal.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); $('#' + close).click(); }
    if (event.key === 'Tab') {
      const nodes = [...modal.querySelectorAll('button,input')].filter(n => !n.disabled && !n.classList.contains('hidden'));
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  });
}

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
$('#serverUrl').addEventListener('input', () => localStorage.setItem('serverUrl', $('#serverUrl').value.trim()));
$('#userName').value = localStorage.getItem('userName') || '';
$('#userName').addEventListener('input', () => localStorage.setItem('userName', $('#userName').value.trim()));
window.electronAPI.onRuntimeError(async message => { toast(message, 'error'); await leaveRoom(); });
// 启动时自动检测一次
testServerConnection();

// --- 回车键快捷提交 ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && settingsModal.classList.contains('hidden')) {
    if ($('#lobby').classList.contains('active')) {
      if (e.target.tagName !== 'BUTTON') { e.preventDefault(); $('#btnConnect').click(); }
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

// GitHub Releases update check is explicit so it does not create background traffic.
const updateStatus = $('#updateStatus');
const btnCheckUpdate = $('#btnCheckUpdate');
const btnDownloadUpdate = $('#btnDownloadUpdate');
const updateActions = $('#updateActions');
function setUpdateStatus(message, kind = '') {
  updateStatus.textContent = message;
  updateStatus.dataset.kind = kind;
}
btnCheckUpdate?.addEventListener('click', async () => {
  btnCheckUpdate.disabled = true;
  updateActions.classList.add('hidden');
  setUpdateStatus('正在检查…');
  try {
    const result = await window.electronAPI.checkForUpdate();
    if (result.available) {
      setUpdateStatus(`发现新版本 ${result.version}`, 'update');
      updateActions.classList.remove('hidden');
    } else {
      setUpdateStatus(result.development ? '开发模式不检查更新' : `已是最新版本（${result.currentVersion}）`, 'ok');
    }
  } catch (error) {
    setUpdateStatus(error?.message || '检查更新失败', 'error');
  } finally {
    btnCheckUpdate.disabled = false;
  }
});
btnDownloadUpdate?.addEventListener('click', async () => {
  btnDownloadUpdate.disabled = true;
  btnCheckUpdate.disabled = true;
  setUpdateStatus('正在下载更新…');
  try {
    await window.electronAPI.downloadAndInstallUpdate();
  } catch (error) {
    setUpdateStatus(error?.message || '无法打开下载页面', 'error');
    btnCheckUpdate.disabled = false;
  } finally {
    btnDownloadUpdate.disabled = false;
  }
});
window.electronAPI.onUpdateProgress?.(percent => setUpdateStatus(`正在下载更新… ${Math.round(percent)}%`));

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
      $('#settingsModal h2').textContent = '系统设置';
      $$('.setting-codec').forEach(el => el.style.display = '');
      $$('.setting-server').forEach(el => el.style.display = '');
      $$('.setting-theme').forEach(el => el.style.display = '');
      $$('.setting-update').forEach(el => el.style.display = '');
      $$('.setting-room').forEach(el => el.style.display = 'none');
      settingsModal.classList.remove('hidden');
    });
  }
  if (btnRoomSettings) {
    btnRoomSettings.addEventListener('click', () => {
      $('#settingsModal h2').textContent = '共享设置';
      $$('.setting-codec').forEach(el => el.style.display = 'none');
      $$('.setting-server').forEach(el => el.style.display = 'none');
      $$('.setting-theme').forEach(el => el.style.display = 'none');
      $$('.setting-update').forEach(el => el.style.display = 'none');
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
