// ============================================================
// ScreenSh — 入口文件：UI 事件绑定
// ============================================================
import { readCachedImage, saveCachedImage } from './image-cache.mjs';
import { MAX_IMAGE_BYTES, isImageData } from './image-data.mjs';
import { state, $, $$ } from './shared.js';
import { toast } from './toast.js';
import { socket, connectServer, requestServer, applyServerState, rememberJoinCredentials } from './signaling.js';
import { openScreenPicker, selectScreenSourceTab, startScreenCapture, stopSharing, stopWatch, externalObsEnded } from './media.js';
import { leaveRoom, enterRoom } from './room.js';
import { normalizePeers } from './easytier-peers.mjs';
import { requestPassword } from './password-dialog.js';
import { showContextMenu } from './context-menu.js';
import { initVoice } from './voice.js';
import { initAccompaniment } from './accompaniment.js';
import { bindRenderingSettings } from './rendering-settings.mjs';
import { initMemberNetwork } from './member-network.js';
import { initSoundVolume } from './sound-volume.mjs';
import { initStartupSettings, lastConnectedServer } from './startup-settings.mjs';
import { joinPreferredChannel } from './server-channel-preferences.mjs';
import { avatarThumbnail } from './avatar-thumbnail.mjs';
import { initSettingsNavigation } from './ui.js';
import { AppPresence } from './app-presence.mjs';
import { normalizeServerAddress, connectServerAddress } from './server-address.mjs';
import { serverIdentity } from './server-identity.mjs';
import { initServerInfo } from './server-info.mjs';
import { initChat } from './chat.js';
import { initEasyTierSettings } from './easytier-settings.mjs';
import { initUpdateAcceleration } from './update-acceleration-ui.mjs';

const initialAvatar = state.userAvatar;
initMemberNetwork();
initServerInfo();
initChat({state,getSocket:()=>socket,requestServer});
initSoundVolume();
initStartupSettings(window.electronAPI, toast);
initEasyTierSettings(window.electronAPI);
const appPresence = new AppPresence({ storage: localStorage, connect: (url, options) => io(url, options) });
appPresence.sync();
const avatarReady = readCachedImage('avatar').then(avatar => {
  if (avatar !== undefined && state.userAvatar === initialAvatar) { state.userAvatar = avatar; applyAvatarImage(avatar); }
}).catch(error => console.error('Avatar cache:', error));

document.addEventListener('dragstart', event => {
  if (event.target instanceof Element && event.target.closest('img,svg,.channel-icon,.profile-avatar,.server-icon,.bookmark-icon,.member-avatar,.avatar')) event.preventDefault();
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
});

// 执行初始化
initTheme();
initSettingsNavigation();

// A server has one permanent room; its stable ID also names the EasyTier network.
async function joinServer() {
  await avatarReady;
  if (state.joining || state.leaving || state.runtimeCleanupFailed || state.roomId) return;
  const userName = $('#userName').value.trim();
  if (!userName) { $('#userName').focus(); return toast('请输入名称', 'error'); }
  if (userName.length > 20) return toast('名称最多20个字符', 'error');
  const serverAddress = $('#serverUrl').value.trim();
  try {
    normalizeServerAddress(serverAddress);
  } catch { return toast('请输入有效的服务器域名或 IP，可附加端口，不要附加路径', 'error'); }
  localStorage.setItem('userName', userName); localStorage.setItem('serverUrl', serverAddress);
  state.joining = true; $('#btnConnect').disabled = true; $('#btnConnect').textContent = '连接中…';
  try {
    const { connection, url: serverUrl } = await connectServerAddress(serverAddress, url => connectServer(url, serverAddress));
    const info = await requestServer('server-info', {}, connection);
    if (info.protocol !== 2 || !/^[a-f0-9-]{36}$/.test(info.serverId)) throw new Error('请升级为支持频道的服务器');
    if (info.channelFeatures !== 1) throw new Error('请更新频道服务器，以支持临时频道和频道密码');
    if (info.chatVersion !== 1) throw new Error('请更新频道服务器，以支持文字聊天');
    // A link outage can leave our previous socket alive on the server until
    // its heartbeat expires. Authenticate preflight as that same member too.
    const identity = serverIdentity(localStorage, info.serverId, () =>
      Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''));
    let password = '', access;
    if (info.passwordRequired) {
      try { password = await window.electronAPI.getSavedServerPassword(serverUrl, info.serverId); }
      catch { /* A storage failure must not prevent a manual connection. */ }
      if (password) {
        try { access = await requestServer('check-access', { userName, password, identity }, connection); }
        catch (error) {
          if (!['服务器密码错误', '请输入服务器密码'].includes(error.message)) throw error;
          password = '';
          await window.electronAPI.saveServerPassword(serverUrl, info.serverId, '').catch(() => {});
          toast('保存的服务器密码已失效，请重新输入');
        }
      }
      if (!password) {
        const answer = await requestPassword({ connection });
        if (!answer) { await leaveRoom(); return; }
        password = answer.password;
      }
    }
    access ||= await requestServer('check-access', { userName, password, identity }, connection);
    if (!Array.isArray(access.easytierPeers)) throw new Error('请更新服务端以使用统一组网节点');
    const easytierPeers = normalizePeers(access.easytierPeers);
    rememberJoinCredentials({ userName, identity, password });
    state.virtualIp = await window.electronAPI.startEasyTier(info.serverId, easytierPeers);
    state.noTun = (await window.electronAPI.getTunnelMode()) === 'no-tun';
    const joined = await joinPreferredChannel(info.serverId, { userName, identity, password, easytierPeers, virtualIp: state.virtualIp, avatar: state.userAvatar, voiceDeafened: localStorage.getItem('voiceDeafened') === 'true' }, payload => requestServer('join-server', payload, connection));
    if (!connection.connected) throw new Error('连接已断开，请重试');
    state.roomId = info.serverId; state.userName = userName;
    enterRoom(info.serverId); applyServerState(joined);
    const addressIdentityKey = 'serverIdentity:' + new URL(serverUrl).origin + ':' + info.serverId;
    if (!localStorage.getItem(addressIdentityKey)) localStorage.setItem(addressIdentityKey, identity);
    appPresence.sync({ retryRejected: true });
    localStorage.setItem('lastConnectedServer', JSON.stringify({ url: serverAddress, userName }));
    try { await window.electronAPI.saveServerPassword(serverUrl, info.serverId, password); }
    catch { if (password) toast('连接成功，但服务器密码未能保存', 'error'); }
  } catch (error) { toast(error.message, 'error'); await leaveRoom(); }
  finally { state.joining = false; $('#btnConnect').disabled = state.leaving || state.runtimeCleanupFailed; $('#btnConnect').textContent = '连接服务器'; }
}
$('#btnConnect').addEventListener('click', joinServer);

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('请选择 PNG、JPEG、WebP 或 GIF 图片'));
    if (file.size > MAX_IMAGE_BYTES) return reject(new Error('图片不能大于2MB'));
    const reader = new FileReader(); reader.onload = () => {
      if (!isImageData(reader.result)) return reject(new Error('图片无效或大于2MB，请重新选择'));
      resolve(reader.result);
    }; reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file);
  });
}
let profileAvatarRevision = 0;
function applyAvatarImage(data) {
  const revision = ++profileAvatarRevision;
  const paint = thumbnail => document.querySelectorAll('.profile-avatar').forEach(node => { node.textContent = thumbnail ? '' : '👤'; node.style.backgroundImage = thumbnail ? `url("${thumbnail}")` : ''; node.classList.toggle('has-image', !!thumbnail); });
  paint(null);
  if (data) avatarThumbnail(data).then(thumbnail => { if (revision === profileAvatarRevision) paint(thumbnail); }).catch(() => {});
}
let avatarBusy = false, serverIconBusy = false;
async function saveAvatar(avatar) {
  if (state.roomId) await requestServer('set-avatar', { avatar });
  state.userAvatar = avatar;
  await saveCachedImage('avatar', avatar); localStorage.removeItem('userAvatar');
  applyAvatarImage(avatar);
}
async function chooseAvatar(file) {
  if (avatarBusy || !file) return;
  avatarBusy = true;
  try {
    const avatar = await readImage(file);
    await saveAvatar(avatar);
  } catch (error) { toast(error.message, 'error'); }
  finally { avatarBusy = false; }
}
async function resetAvatar() {
  if (avatarBusy) return;
  avatarBusy = true;
  try { await saveAvatar(null); }
  catch (error) { toast(error.message, 'error'); }
  finally { avatarBusy = false; }
}
document.addEventListener('user-avatar-updated', event => applyAvatarImage(event.detail));
for (const id of ['btnAvatar', 'btnRoomAvatar']) $('#' + id).addEventListener('contextmenu', event => showContextMenu(event, [
  { label: '更换头像', run: () => $('#avatarInput').click() },
  { label: '恢复默认头像', disabled: !state.userAvatar || avatarBusy, run: resetAvatar },
]));
$('#avatarInput')?.addEventListener('change', event => { void chooseAvatar(event.target.files?.[0]); event.target.value = ''; });
applyAvatarImage(state.userAvatar);
$('#btnServerIcon')?.addEventListener('click', () => $('#serverIconInput').click());
$('#serverIconInput')?.addEventListener('change', async event => {
  if (serverIconBusy || !event.target.files?.[0]) return;
  serverIconBusy = true;
  try { const icon = await readImage(event.target.files?.[0]); await requestServer('set-server-icon', { icon }); }
  catch (error) { toast(error.message, 'error'); }
  finally { serverIconBusy = false; event.target.value = ''; }
});
$('#btnResetServerIcon').addEventListener('click', async () => {
  if (serverIconBusy) return;
  serverIconBusy = true;
  try { await requestServer('set-server-icon', { icon: null }); }
  catch (error) { toast(error.message, 'error'); }
  finally { serverIconBusy = false; }
});

// --- 离开房间 ---
$('#btnLeave').addEventListener('click', leaveRoom);
$('#btnRetryCleanup').addEventListener('click', leaveRoom);

// --- 共享屏幕：展开屏幕源选择面板 ---
$('#btnShare').addEventListener('click', openScreenPicker);
document.querySelectorAll('[data-source-tab]').forEach(button=>button.addEventListener('click',()=>selectScreenSourceTab(button.dataset.sourceTab)));

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
    if (event.key === 'Tab') {
      const nodes = [...modal.querySelectorAll('button,input')].filter(n => !n.disabled && !n.classList.contains('hidden'));
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  });
}

// Reopening a settings/dialog page always starts at its first field.
for (const modal of document.querySelectorAll('.modal')) {
  let wasOpen = !modal.classList.contains('hidden');
  new MutationObserver(() => {
    const open = !modal.classList.contains('hidden');
    if (open && !wasOpen) { for (const panel of modal.querySelectorAll('.modal-content, .modal-body')) panel.scrollTop = 0; }
    wasOpen = open;
  }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}

// --- 确认开始共享 ---
$('#btnConfirmShare').addEventListener('click', startScreenCapture);

// --- 停止共享 ---
$('#btnStopShare').addEventListener('click', stopSharing);

// --- 返回大厅 / 取消观看 ---
$('#btnStopWatch').addEventListener('click', () => stopWatch({ retain: true }));

// --- 信令服务器连通性检测 ---
async function testServerConnection() {
  if ($('#btnTestServer').disabled) return;
  const url = $('#serverUrl').value.trim();
  if (!url) { $('#serverUrl').focus(); return toast('请先填写服务器地址', 'error'); }
  try {
    normalizeServerAddress(url);
  } catch { return toast('请输入有效的服务器域名或 IP，可附加端口，不要附加路径', 'error'); }
  $('#btnTestServer').textContent = '检测中...';
  $('#btnTestServer').disabled = true;

  try {
    const { connection } = await connectServerAddress(url, address => io(address, { transports: ['polling', 'websocket'], tryAllTransports: true, timeout: 5000, reconnection: false }));
    $('#serverStatus').className = 'status-dot connected';
    connection.disconnect();
  } catch {
    $('#serverStatus').className = 'status-dot disconnected';
    toast('无法连接到服务器', 'error');
  } finally {
    $('#btnTestServer').textContent = '检测';
    $('#btnTestServer').disabled = false;
  }
}

$('#btnTestServer').addEventListener('click', testServerConnection);

$('#serverUrl').value = localStorage.getItem('serverUrl') || '';
$('#serverUrl').addEventListener('input', () => localStorage.setItem('serverUrl', $('#serverUrl').value.trim()));
$('#userName').value = localStorage.getItem('userName') || '';
$('#userName').addEventListener('input', () => localStorage.setItem('userName', $('#userName').value.trim()));
window.electronAPI.onRuntimeError(async message => { toast(message, 'error'); await leaveRoom(); });
window.electronAPI.onShareEnded?.(externalObsEnded);
// Only test a server address previously saved by the user.
if ($('#serverUrl').value) testServerConnection();

// Forms are submitted explicitly with their buttons, never by an input's Enter key.
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
}, true);

// --- 窗口关闭前清理 ---
window.addEventListener('beforeunload', () => {
  appPresence.stop();
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
  });
  state.resolution = localStorage.getItem('resolution') || state.resolution;
  const savedCaptureMethod = localStorage.getItem('captureMethod');
  state.captureMethod = ['auto', 'wgc', 'dxgi'].includes(savedCaptureMethod) ? savedCaptureMethod : 'auto';
  $('#captureMethodSelect').value = state.captureMethod;
  $('#captureMethodSelect').addEventListener('change', e => {
    state.captureMethod = e.target.value;
    localStorage.setItem('captureMethod', state.captureMethod);
  });
  state.frameRate = parseInt(localStorage.getItem('frameRate')) || state.frameRate;
  state.maxBitrate = localStorage.getItem('maxBitrate') !== null
                     ? parseInt(localStorage.getItem('maxBitrate'))
                     : state.maxBitrate;
  state.shareAudio = localStorage.getItem('shareAudio') === 'true';
  localStorage.removeItem('lowBandwidth');
  state.adaptiveResolution = localStorage.getItem('adaptiveResolution') === 'true';
  $('#adaptiveResolutionCheckbox').checked = state.adaptiveResolution;
  $('#adaptiveResolutionCheckbox').addEventListener('change', event => {
    state.adaptiveResolution = event.target.checked;
    localStorage.setItem('adaptiveResolution', String(state.adaptiveResolution));
  });
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
    } else {
      bitrateInput.disabled = false;
      state.maxBitrate = parseInt(bitrateInput.value) || 1500;
      bitrateInput.value = state.maxBitrate;
      localStorage.setItem('maxBitrate', state.maxBitrate);
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
  });

  $('#resolutionSelect').addEventListener('change', (e) => {
    state.resolution = e.target.value;
    localStorage.setItem('resolution', state.resolution);
  });

  $('#frameRateSelect').addEventListener('change', (e) => {
    state.frameRate = parseInt(e.target.value);
    localStorage.setItem('frameRate', state.frameRate);
  });

  $('#audioBitrateSelect').value = state.audioBitrate;
  $('#shareAudioCheckbox').checked = state.shareAudio;

  $('#shareAudioCheckbox').addEventListener('change', (e) => {
    state.shareAudio = e.target.checked;
    localStorage.setItem('shareAudio', state.shareAudio);
  });

  $('#audioBitrateSelect').addEventListener('change', (e) => {
    state.audioBitrate = parseInt(e.target.value);
    localStorage.setItem('audioBitrate', state.audioBitrate);
  });

}

initSettings();
void initUpdateAcceleration({notify:toast});
initAccompaniment();
initVoice();

// Automatic checks and downloads share the same state as manual updates.
const updateStatus = $('#updateStatus');
const btnCheckUpdate = $('#btnCheckUpdate');
const btnDownloadUpdate = $('#btnDownloadUpdate');
const updateActions = $('#updateActions');
const autoUpdateCheckbox = $('#autoUpdateCheckbox');
function setUpdateStatus(message, kind = '') {
  updateStatus.textContent = message;
  updateStatus.dataset.kind = kind;
}
function showUpdateState(info) {
  const busy = ['checking','downloading'].includes(info.status);
  btnCheckUpdate.disabled = busy;
  btnDownloadUpdate.disabled = busy;
  updateActions.classList.toggle('hidden', !['available','ready'].includes(info.status));
  btnDownloadUpdate.textContent = info.status === 'ready' ? '立即安装' : '下载更新';
  if (info.status === 'checking') setUpdateStatus('正在检查…');
  else if (info.status === 'downloading') {
    const amount=info.total>0?` · ${(info.transferred/1048576).toFixed(1)} / ${(info.total/1048576).toFixed(1)} MB`:'';
    setUpdateStatus(`正在${info.downloadMode==='differential'?'差分下载':'下载更新'}… ${Math.round(info.percent || 0)}%${amount}`);
  }
  else if (info.status === 'ready') setUpdateStatus(`新版本 ${info.version} 已下载，${(info.enabled ?? autoUpdateCheckbox.checked) ? '下次启动时安装' : '可点击立即安装'}`, 'update');
  else if (info.status === 'available') setUpdateStatus(`发现新版本 ${info.version}`, 'update');
  else if (info.status === 'current') setUpdateStatus(`已是最新版本（${info.currentVersion}）`, 'ok');
  else if (info.status === 'error') setUpdateStatus(info.message, 'error');
}
window.electronAPI.onUpdateState?.(showUpdateState);
window.electronAPI.getUpdateSettings?.().then(info => {
  autoUpdateCheckbox.checked = info.enabled;
  showUpdateState(info);
}).catch(error => setUpdateStatus(error.message, 'error'));
autoUpdateCheckbox.addEventListener('change', async () => {
  const enabled = autoUpdateCheckbox.checked;
  autoUpdateCheckbox.disabled = true;
  try { autoUpdateCheckbox.checked = await window.electronAPI.setAutoUpdate(enabled); }
  catch (error) { autoUpdateCheckbox.checked = !enabled; toast(error.message, 'error'); }
  finally { autoUpdateCheckbox.disabled = false; }
});
btnCheckUpdate?.addEventListener('click', async () => {
  btnCheckUpdate.disabled = true;
  updateActions.classList.add('hidden');
  setUpdateStatus('正在检查…');
  try {
    const result = await window.electronAPI.checkForUpdate();
    if (result.development) setUpdateStatus('开发模式不检查更新', 'ok');
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
function showSettings() {
  settingsModal.classList.remove('hidden');
  settingsModal.querySelector('.modal-body').scrollTo({ top: 0, behavior: 'instant' });
}

// Help remains accessible by mouse, click, or keyboard without toggling a setting.
$$('.help-tip').forEach(tip => {
  if(tip.closest('#easyTierSettingsDialog'))return;
  tip.tabIndex = 0;
  tip.setAttribute('role', 'note');
  tip.setAttribute('aria-label', tip.dataset.tooltip);
  tip.addEventListener('click', event => { event.preventDefault(); tip.focus(); });
  tip.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
  });
});

if (settingsModal && btnCloseSettings) {
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      $('#settingsModal h2').textContent = '系统设置';
      $$('.setting-hardware, .setting-voice, .setting-sounds, .setting-startup, .setting-lolping, .setting-easytier, .setting-chat').forEach(el => el.style.display = '');
      $$('.setting-theme').forEach(el => el.style.display = '');
      $$('.setting-update').forEach(el => el.style.display = '');
      $$('.setting-room').forEach(el => el.style.display = 'none');
      showSettings();
    });
  }
  if (btnRoomSettings) {
    btnRoomSettings.addEventListener('click', () => {
      $('#settingsModal h2').textContent = '共享设置';
      $$('.setting-hardware, .setting-voice, .setting-sounds, .setting-startup, .setting-lolping, .setting-easytier, .setting-chat').forEach(el => el.style.display = 'none');
      $$('.setting-theme').forEach(el => el.style.display = 'none');
      $$('.setting-update').forEach(el => el.style.display = 'none');
      $$('.setting-room').forEach(el => el.style.display = '');
      showSettings();
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

// Bookmarks are stored locally; connected server metadata keeps them current.
const bookmarkIconCache = new Map();
function readBookmarks() {
  try { const value = JSON.parse(localStorage.getItem('serverBookmarks') || '[]'); return Array.isArray(value) ? value.map(item => item.icon === 'cached' ? { ...item, icon: bookmarkIconCache.get(item.url) || null, cachedIcon: true } : item) : []; }
  catch { return []; }
}
function saveBookmarks(value) {
  const records = value.slice(0, 30).map(item => {
    const { cachedIcon, ...record } = item;
    if (record.icon?.startsWith('data:')) {
      if (bookmarkIconCache.get(record.url) !== record.icon) {
        bookmarkIconCache.set(record.url, record.icon);
        void saveCachedImage('bookmark:' + record.url, record.icon).catch(console.error);
      }
      return { ...record, icon: 'cached' };
    }
    return cachedIcon && !record.icon ? { ...record, icon: 'cached' } : record;
  });
  localStorage.setItem('serverBookmarks', JSON.stringify(records));
  appPresence.sync();
}
for (const item of readBookmarks().filter(item => item.cachedIcon)) {
  void readCachedImage('bookmark:' + item.url).then(icon => {
    if (icon && !bookmarkIconCache.has(item.url) && readBookmarks().some(record => record.url === item.url && record.cachedIcon)) bookmarkIconCache.set(item.url, icon);
    renderBookmarks();
  }).catch(console.error);
}
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
        { label: '删除书签', run: () => { const next = readBookmarks(); next.splice(index, 1); saveBookmarks(next); renderBookmarks(); } },
      ]);
    }));
  };
  render('#bookmarkList'); render('#roomBookmarkList', true);
}
function addBookmark(url, name = '') {
  url = url.trim();
  if (!url) return toast('请输入服务器地址', 'error');
  try { normalizeServerAddress(url); }
  catch { return toast('请输入有效的服务器域名或 IP，可附加端口，不要附加路径', 'error'); }
  name = name.trim() || new URL(normalizeServerAddress(url)).hostname;
  const bookmarks = readBookmarks().filter(item => item.url !== url);
  const previous = readBookmarks().find(item => item.url === url);
  bookmarks.unshift({ ...previous, name, url }); saveBookmarks(bookmarks); renderBookmarks();
}
document.addEventListener('server-icon-updated', event => {
  $('#btnResetServerIcon').disabled = !event.detail;
});
document.addEventListener('server-bookmark-updated', event => {
  const { url, name, icon, iconResolved, autoAdd } = event.detail;
  if (!url) return;
  try {
    const bookmarks = readBookmarks(), index = bookmarks.findIndex(item => item.url === url);
    if (index < 0 && !autoAdd) return;
    const previous = bookmarks[index];
    const next = { ...previous, url, name, ...(iconResolved ? { icon, cachedIcon: false } : {}) };
    if (previous && previous.name === next.name && (!iconResolved || previous.icon === icon && (icon !== null || !previous.cachedIcon))) return;
    if (index < 0) bookmarks.unshift(next); else bookmarks[index] = next;
    saveBookmarks(bookmarks); renderBookmarks();
  } catch (error) { console.error('Bookmark sync:', error); toast('服务器已连接，但书签保存失败', 'error'); }
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
  document.querySelectorAll('#btnCollapseBookmarks, #btnCollapseRoomBookmarks').forEach(button => { button.classList.toggle('is-collapsed', collapsed); button.title = collapsed ? '展开书签' : '收起书签'; button.setAttribute('aria-label', button.title); button.setAttribute('aria-expanded', String(!collapsed)); });
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
setBookmarkCollapsed(localStorage.getItem('bookmarksCollapsed') === 'true');
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
    normalizeServerAddress(url);
    const next = readBookmarks();
    const old = next[editingBookmarkIndex];
    next[editingBookmarkIndex] = { ...(old?.url === url ? old : {}), name, url };
    saveBookmarks(next); renderBookmarks(); $('#bookmarkEditDialog').classList.add('hidden');
  } catch { $('#bookmarkEditError').textContent = '请输入有效的域名或 IP，可附加端口，不要附加路径'; }
});

const startupServer = lastConnectedServer();
if (startupServer) {
  $('#serverUrl').value = startupServer.url;
  $('#userName').value = localStorage.getItem('userName') || startupServer.userName;
  void joinServer();
}
