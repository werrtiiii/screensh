// ============================================================
// ScreenSh — 入口文件：UI 事件绑定
// ============================================================
import { state, $, $$ } from './shared.js';
import { toast } from './toast.js';
import { socket, connectServer, requestServer, applyServerState, rememberJoinCredentials } from './signaling.js';
import { loadScreenSources, startScreenCapture, stopSharing, stopWatch } from './media.js';
import { leaveRoom, enterRoom } from './room.js';
import { normalizePeers } from './easytier-peers.mjs';
import { requestPassword } from './password-dialog.js';
import { showContextMenu } from './context-menu.js';
import { initVoice } from './voice.js';
import { initAccompaniment } from './accompaniment.js';
import { bindRenderingSettings } from './rendering-settings.mjs';

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
    rememberJoinCredentials({ userName, identity, password });
    toast('正在准备网络连接…');
    state.virtualIp = await window.electronAPI.startEasyTier(info.serverId, easytierPeers);
    const joined = await requestServer('join-server', { userName, identity, password, easytierPeers, virtualIp: state.virtualIp, avatar: state.userAvatar }, connection);
    if (!connection.connected) throw new Error('连接已断开，请重试');
    state.roomId = info.serverId; state.userName = userName;
    enterRoom(info.serverId); applyServerState(joined);
  } catch (error) { toast(error.message, 'error'); await leaveRoom(); }
  finally { state.joining = false; $('#btnConnect').disabled = state.leaving || state.runtimeCleanupFailed; $('#btnConnect').textContent = '连接服务器'; }
}
$('#btnConnect').addEventListener('click', joinServer);

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('请选择 PNG、JPEG、WebP 或 GIF 图片'));
    if (file.size > 128 * 1024) return reject(new Error('图片不能大于128KB'));
    const reader = new FileReader(); reader.onload = () => {
      if (typeof reader.result !== 'string' || reader.result.length > 128 * 1024) return reject(new Error('图片编码后不能大于128KB，请压缩图片后重试'));
      resolve(reader.result);
    }; reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file);
  });
}
function applyAvatarImage(data) {
  document.querySelectorAll('.profile-avatar').forEach(node => { node.textContent = data ? '' : '👤'; node.style.backgroundImage = data ? `url("${data}")` : ''; node.classList.toggle('has-image', !!data); });
}
let avatarBusy = false, serverIconBusy = false;
async function saveAvatar(avatar) {
  if (state.roomId) await requestServer('set-avatar', { avatar });
  state.userAvatar = avatar;
  if (avatar) localStorage.setItem('userAvatar', avatar); else localStorage.removeItem('userAvatar');
  applyAvatarImage(avatar);
}
async function chooseAvatar(file) {
  if (avatarBusy || !file) return;
  avatarBusy = true;
  try {
    const avatar = await readImage(file);
    await saveAvatar(avatar);
    toast('头像已保存', 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { avatarBusy = false; }
}
async function resetAvatar() {
  if (avatarBusy) return;
  avatarBusy = true;
  try { await saveAvatar(null); toast('头像已恢复默认', 'success'); }
  catch (error) { toast(error.message, 'error'); }
  finally { avatarBusy = false; }
}
document.addEventListener('user-avatar-updated', event => applyAvatarImage(event.detail));
for (const id of ['btnAvatar', 'btnRoomAvatar']) $('#' + id).addEventListener('contextmenu', event => showContextMenu(event, [
  { label: '更换头像', run: () => $('#avatarInput').click() },
  { label: '恢复默认头像', disabled: !state.userAvatar || avatarBusy, run: resetAvatar },
]));
for (const id of ['btnAvatar', 'btnRoomAvatar']) $('#' + id)?.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#avatarInput')?.click(); }
});
$('#avatarInput')?.addEventListener('change', event => { void chooseAvatar(event.target.files?.[0]); event.target.value = ''; });
applyAvatarImage(state.userAvatar);
$('#btnServerIcon')?.addEventListener('click', () => $('#serverIconInput').click());
$('#serverIconInput')?.addEventListener('change', async event => {
  if (serverIconBusy || !event.target.files?.[0]) return;
  serverIconBusy = true;
  try { const icon = await readImage(event.target.files?.[0]); await requestServer('set-server-icon', { icon }); toast('服务器图标已保存', 'success'); }
  catch (error) { toast(error.message, 'error'); }
  finally { serverIconBusy = false; event.target.value = ''; }
});
$('#btnResetServerIcon').addEventListener('click', async () => {
  if (serverIconBusy) return;
  serverIconBusy = true;
  try { await requestServer('set-server-icon', { icon: null }); toast('服务器图标已恢复默认', 'success'); }
  catch (error) { toast(error.message, 'error'); }
  finally { serverIconBusy = false; }
});

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
  const url = $('#serverUrl').value.trim();
  if (!url) { $('#serverUrl').focus(); return toast('请先填写服务器地址', 'error'); }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
  } catch { return toast('请输入有效的 HTTP 或 HTTPS 服务器地址，不要附加路径', 'error'); }
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
    toast('无法连接到服务器', 'error');
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

$('#serverUrl').value = localStorage.getItem('serverUrl') || '';
$('#serverUrl').addEventListener('input', () => localStorage.setItem('serverUrl', $('#serverUrl').value.trim()));
$('#userName').value = localStorage.getItem('userName') || '';
$('#userName').addEventListener('input', () => localStorage.setItem('userName', $('#userName').value.trim()));
window.electronAPI.onRuntimeError(async message => { toast(message, 'error'); await leaveRoom(); });
// Only test a server address previously saved by the user.
if ($('#serverUrl').value) testServerConnection();

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

// --- 设置面板与渲染逻辑 ---
function initSettings() {
  const hardwareCheckbox = $('#hardwareAccelerationCheckbox');
  localStorage.removeItem('hardwareAcceleration');
  void bindRenderingSettings(hardwareCheckbox, window.electronAPI, toast);
  state.autoPreview = localStorage.getItem('autoPreview') !== 'false';
  $('#autoPreviewCheckbox').checked = state.autoPreview;
  $('#autoPreviewCheckbox').addEventListener('change', e => {
    state.autoPreview = e.target.checked;
    localStorage.setItem('autoPreview', state.autoPreview);
  });
  const savedEncoder = localStorage.getItem('videoEncoder');
  state.videoEncoder = ['x264', 'nvenc', 'amf', 'qsv'].includes(savedEncoder) ? savedEncoder : 'x264';
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
initAccompaniment();
initVoice();

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
const btnRoomSettings = $('#btnRoomSettingsToolbar');  // 房间内共享设置按钮
const btnRoomSystemSettings = $('#btnRoomSettings');
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
      $$('.setting-hardware, .setting-voice').forEach(el => el.style.display = '');
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
      $$('.setting-hardware, .setting-voice').forEach(el => el.style.display = 'none');
      $$('.setting-server').forEach(el => el.style.display = 'none');
      $$('.setting-theme').forEach(el => el.style.display = 'none');
      $$('.setting-update').forEach(el => el.style.display = 'none');
      $$('.setting-room').forEach(el => el.style.display = '');
      settingsModal.classList.remove('hidden');
    });
  }
  if (btnRoomSystemSettings) btnRoomSystemSettings.addEventListener('click', () => btnSettings?.click());
  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });
}

// Server bookmarks and the profile name live locally, independent of server state.
function readBookmarks() {
  try { const value = JSON.parse(localStorage.getItem('serverBookmarks') || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function saveBookmarks(value) { localStorage.setItem('serverBookmarks', JSON.stringify(value.slice(0, 30))); }
function escapeBookmark(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function renderBookmarks() {
  const bookmarks = readBookmarks();
  const render = (selector, compact = false) => {
    const list = $(selector); if (!list) return;
    list.innerHTML = bookmarks.map((item, index) => `<button class="bookmark-item" data-bookmark-index="${index}" aria-label="${escapeBookmark(item.name)}"><span class="bookmark-icon">S${item.icon ? `<img src="${escapeBookmark(item.icon)}" alt="" onerror="this.remove()" />` : ''}</span><span><b>${escapeBookmark(item.name)}</b><small>${escapeBookmark(item.url)}</small></span></button>`).join('');
    list.querySelectorAll('[data-bookmark-index]').forEach(button => button.addEventListener('click', () => {
      const item = bookmarks[Number(button.dataset.bookmarkIndex)];
      $('#serverUrl').value = item.url; localStorage.setItem('serverUrl', item.url);
      if ($('#lobby').classList.contains('active')) $('#btnConnect').focus();
    }));
    list.querySelectorAll('[data-bookmark-index]').forEach(button => button.addEventListener('contextmenu', event => {
      const index = Number(button.dataset.bookmarkIndex);
      const item = bookmarks[index];
      showContextMenu(event, [
        { label: '编辑书签', run: () => editBookmark(index, item) },
        { label: '删除书签', run: () => { const next = readBookmarks(); next.splice(index, 1); saveBookmarks(next); renderBookmarks(); toast('书签已删除', 'success'); } },
      ]);
    }));
  };
  render('#bookmarkList'); render('#roomBookmarkList', true);
}
function addBookmark(url, name = '') {
  url = url.trim();
  if (!url) return toast('请输入服务器地址', 'error');
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); url = parsed.origin; }
  catch { return toast('请输入有效的 HTTP 或 HTTPS 地址', 'error'); }
  name = name.trim() || new URL(url).hostname;
  const bookmarks = readBookmarks().filter(item => item.url !== url);
  const previous = readBookmarks().find(item => item.url === url);
  bookmarks.unshift({ name, url, ...(previous?.icon ? { icon: previous.icon } : {}) }); saveBookmarks(bookmarks); renderBookmarks(); toast('服务器已加入书签', 'success');
}
document.addEventListener('server-icon-updated', event => {
  $('#btnResetServerIcon').disabled = !event.detail;
  const url = $('#serverUrl')?.value.trim(); if (!url) return;
  const next = readBookmarks().map(item => item.url === url ? { ...item, icon: event.detail } : item); saveBookmarks(next); renderBookmarks();
});
function addCurrentBookmark() {
  const url = $('#serverUrl')?.value.trim();
  if (!url) return toast('请先填写服务器地址', 'error');
  addBookmark(url);
}
let editingBookmarkIndex = -1;
function editBookmark(index, item) {
  editingBookmarkIndex = index;
  $('#bookmarkEditName').value = item.name;
  $('#bookmarkEditUrl').value = item.url;
  $('#bookmarkEditError').textContent = '';
  $('#bookmarkEditDialog').classList.remove('hidden');
  $('#bookmarkEditName').focus();
}
function toggleBookmarkForm(prefix) {
  const formId = prefix ? `${prefix}BookmarkAddForm` : 'bookmarkAddForm';
  const inputId = prefix ? `${prefix}BookmarkUrlInput` : 'bookmarkUrlInput';
  const form = $(`#${formId}`);
  form?.classList.toggle('hidden');
  if (!form?.classList.contains('hidden')) $(`#${inputId}`)?.focus();
}
$('#btnAddBookmark')?.addEventListener('click', () => toggleBookmarkForm(''));
$('#btnRoomBookmark')?.addEventListener('click', addCurrentBookmark);
$('#bookmarkAddForm')?.addEventListener('submit', event => { event.preventDefault(); addBookmark($('#bookmarkUrlInput').value); $('#bookmarkUrlInput').value = ''; $('#bookmarkAddForm').classList.add('hidden'); });
$('#roomBookmarkAddForm')?.addEventListener('submit', event => { event.preventDefault(); addBookmark($('#roomBookmarkUrlInput').value); $('#roomBookmarkUrlInput').value = ''; $('#roomBookmarkAddForm').classList.add('hidden'); });
function setBookmarkCollapsed(collapsed) {
  localStorage.setItem('bookmarksCollapsed', collapsed);
  document.querySelectorAll('.bookmark-list, .bookmark-empty').forEach(node => node.classList.toggle('collapsed', collapsed));
  document.querySelectorAll('#btnCollapseBookmarks, #btnCollapseRoomBookmarks').forEach(button => { button.textContent = collapsed ? '⌄' : '⌃'; button.title = collapsed ? '展开书签' : '收起书签'; });
}
function toggleBookmarkLists() { setBookmarkCollapsed(localStorage.getItem('bookmarksCollapsed') !== 'true'); }
$('#btnCollapseBookmarks')?.addEventListener('click', toggleBookmarkLists);
$('#btnCollapseRoomBookmarks')?.addEventListener('click', toggleBookmarkLists);
$('#serverSearch')?.addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  $$('#bookmarkList .bookmark-item').forEach(item => { item.hidden = query && !item.textContent.toLowerCase().includes(query); });
});
const savedName = localStorage.getItem('userName') || '';
$('#userName').value = savedName;
$('#roomUserName').value = savedName;
$('#userName').addEventListener('input', event => { localStorage.setItem('userName', event.target.value.trim()); $('#roomUserName').value = event.target.value; });
$('#roomUserName')?.addEventListener('input', event => { localStorage.setItem('userName', event.target.value.trim()); $('#userName').value = event.target.value; });
renderBookmarks();
if (localStorage.getItem('bookmarksCollapsed') === 'true') setBookmarkCollapsed(true);
function focusNameEditor() {
  const input = $('#lobby')?.classList.contains('active') ? $('#userName') : $('#roomUserName');
  input?.focus(); input?.select();
}
$('#btnEditName')?.addEventListener('click', focusNameEditor);
$('#btnEditRoomName')?.addEventListener('click', focusNameEditor);
$('#btnCancelBookmarkEdit')?.addEventListener('click', () => $('#bookmarkEditDialog').classList.add('hidden'));
$('#bookmarkEditDialog')?.addEventListener('click', event => { if (event.target === $('#bookmarkEditDialog')) $('#bookmarkEditDialog').classList.add('hidden'); });
$('#bookmarkEditForm')?.addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#bookmarkEditName').value.trim();
  const url = $('#bookmarkEditUrl').value.trim();
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    const next = readBookmarks();
    const old = next[editingBookmarkIndex];
    next[editingBookmarkIndex] = { name, url: parsed.origin, ...(old?.url === parsed.origin && old.icon ? { icon: old.icon } : {}) };
    saveBookmarks(next); renderBookmarks(); $('#bookmarkEditDialog').classList.add('hidden'); toast('书签已更新', 'success');
  } catch { $('#bookmarkEditError').textContent = '请输入有效的 HTTP 或 HTTPS 地址，不要附加路径'; }
});
