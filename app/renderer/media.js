import { state, $, $$, getIceServers } from './shared.js';
import { toast } from './toast.js';
import { socket, roomUsers } from './signaling.js';
import { WhepSession } from './whep.mjs';
import { attachVideoStats } from './video-stats.mjs';

let session = null, sharingGeneration = 0;
let disposeStats = null;
export function escapeHtml(str) {
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}
export async function loadScreenSources() {
  const list = $('#screenList');
  state.selectedSourceId = null;
  $('#btnConfirmShare').classList.add('hidden');
  list.textContent = '获取显示器和窗口中...';
  try {
    const screens = await window.electronAPI.getScreens();
    list.innerHTML = '';
    for (const screen of screens) {
      const item = document.createElement('div'); item.className = 'screen-item';
      item.textContent = `${screen.type === 'window' ? '窗口' : '显示器'} · ${screen.name}`;
      item.onclick = () => {
        $$('.screen-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected'); state.selectedSourceId = screen.id;
        state.selectedSourceType = screen.type || 'screen';
        $('#btnConfirmShare').classList.remove('hidden');
      };
      list.appendChild(item);
    }
    if (!screens.length) list.textContent = '没有可共享的显示器或窗口';
  } catch (error) { list.textContent = `读取共享源失败：${error.message}`; }
}
export async function startScreenCapture() {
  if (state.startingShare || state.isSharing || state.leaving) return;
  if (!socket?.connected || !state.roomId) return toast('请先连接并加入房间', 'error');
  if (state.selectedSourceId == null) return toast('请选择显示器或窗口', 'error');
  const current = ++sharingGeneration;
  state.startingShare = true; $('#btnConfirmShare').disabled = true;
  try {
    await window.electronAPI.startSharing({
      sourceId: state.selectedSourceId, sourceType: state.selectedSourceType, resolution: state.resolution, frameRate: state.frameRate,
      captureMethod: state.captureMethod,
      videoEncoder: state.videoEncoder,
      maxBitrate: state.maxBitrate, shareAudio: state.shareAudio, audioBitrate: state.audioBitrate,
    });
    if (current !== sharingGeneration || !state.roomId || !socket?.connected) return;
    state.isSharing = true; updateSharingUI(true);
    $('#screenPicker').classList.add('hidden');
    socket.emit('start-sharing'); toast('屏幕共享已开始', 'success');
    if (state.autoPreview) void displayRemoteVideo(socket.id);
  } catch (error) {
    if (current === sharingGeneration) { state.isSharing = false; updateSharingUI(false); toast(error.message, 'error'); }
  } finally { state.startingShare = false; $('#btnConfirmShare').disabled = false; }
}
export async function stopSharing() {
  sharingGeneration++; state.isSharing = false; state.selectedSourceId = null;
  socket?.emit('stop-sharing'); updateSharingUI(false); stopWatch();
  $('#btnConfirmShare').classList.add('hidden');
  try { await window.electronAPI.stopSharing(); } catch (error) { toast(error.message, 'error'); }
}
export function updateSharingUI(sharing) {
  $('#btnShare').classList.toggle('hidden', sharing);
  $('#btnStopShare').classList.toggle('hidden', !sharing);
}
export async function displayRemoteVideo(targetSocketId) {
  stopWatch();
  const targetUser = roomUsers.get(targetSocketId);
  const isSelf = targetSocketId === socket?.id;
  // Local capture is ready before the server broadcasts the updated member list.
  if (isSelf ? !state.isSharing : (!targetUser?.isSharing || !/^\d{1,3}(\.\d{1,3}){3}$/.test(targetUser.virtualIp))) {
    return toast('共享者地址不可用', 'error');
  }
  state.watchingId = targetSocketId;
  $('#userCardsView').classList.add('hidden'); $('#activeVideoView').classList.remove('hidden');
  $('#watchingUserName').textContent = isSelf ? '我的共享预览' : `正在观看 ${targetUser.name} 的共享`;
  const container = $('#videoContainer');
  container.innerHTML = '<video autoplay playsinline controls></video><div class="pip-bar"><button id="btnPip">画中画</button></div>';
  const video = container.querySelector('video');
  video.muted = isSelf;
  video.defaultMuted = isSelf;
  $('#btnPip').onclick = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); }
    catch (error) { toast(`画中画开启失败：${error.message}`, 'error'); }
  };
  const fail = error => { if (session === current) { stopWatch(); toast(`观看失败：${error.message}`, 'error'); } };
  const stream = new MediaStream();
  const host = isSelf ? '127.0.0.1' : targetUser.virtualIp;
  const current = new WhepSession(`http://${host}:8889/live/whep`, getIceServers(), event => {
    if (session !== current) return;
    stream.addTrack(event.track); video.srcObject = stream;
    video.play().catch(() => toast('请点击视频播放按钮'));
  }, fail);
  session = current;
  disposeStats = attachVideoStats(container, current.pc);
  try { await current.start(); } catch (error) { fail(error); }
}
export function stopWatch() {
  disposeStats?.(); disposeStats = null;
  session?.close(); session = null; state.watchingId = null;
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  const video = $('#videoContainer').querySelector('video');
  if (video?.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); video.srcObject = null; }
  $('#activeVideoView').classList.add('hidden'); $('#userCardsView').classList.remove('hidden');
  $('#videoContainer').innerHTML = '';
}
