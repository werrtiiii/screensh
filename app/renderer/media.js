import { state, $, $$, getIceServers } from './shared.js';
import { toast } from './toast.js';
import { socket, roomUsers,requestServer } from './signaling.js';
import { WhepSession } from './whep.mjs';
import { attachVideoStats } from './video-stats.mjs';
import { createShareAdaptation, watchNetwork } from './share-adaptation.mjs';
import { createMediaTunnel } from './media-tunnel.mjs';
import { createExternalObsPanel } from './external-obs-ui.mjs';

let session = null, sharingGeneration = 0;
let stoppingPromise = null;
let shareAdaptation = null;
let disposeStats = null, watchContext = null, retainWatchTimer = null;
let sourceInventory = [], sourceTab = 'window', sourceRequest = 0;
let sourcesLoaded=false,sourcesLoading=false;
let externalObsPanel,externalObsSessionId=null;
function obsPanel(){return externalObsPanel||=createExternalObsPanel({onReady:()=>{if(sourceTab!=='obs'||$('#screenPicker').classList.contains('hidden'))return;state.selectedSourceId='external-obs';state.selectedSourceType='obs';$('#btnConfirmShare').classList.remove('hidden');},onInvalid:()=>{if(sourceTab==='obs'){state.selectedSourceId=null;$('#btnConfirmShare').classList.add('hidden');}}});}
export function escapeHtml(str) {
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}
export async function loadScreenSources() {
  const request=++sourceRequest;
  const list = $('#screenList');
  sourceInventory=[];
  sourcesLoaded=false;
  state.selectedSourceId = null;
  $('#btnConfirmShare').classList.add('hidden');
  list.textContent = '获取显示器和窗口中...';
  sourcesLoading=false;
  if(sourceTab==='obs'){selectScreenSourceTab('obs');return;}
  sourcesLoading=true;
  try {
    const screens = await window.electronAPI.getScreens();
    if(request!==sourceRequest||$('#screenPicker').classList.contains('hidden'))return;
    sourceInventory=screens;
    sourcesLoaded=true;
    if(sourceTab!=='obs'){if(!screens.some(s=>s.type===sourceTab)&&screens.length)sourceTab=screens[0].type||'screen';selectScreenSourceTab(sourceTab);}
  } catch (error) { if(request===sourceRequest)list.textContent = `读取共享源失败：${error.message}`; }
  finally{if(request===sourceRequest)sourcesLoading=false;}
}
export function selectScreenSourceTab(type) {
    sourceTab=type;
    if(state.selectedSourceType!==type){state.selectedSourceId=null;$('#btnConfirmShare').classList.add('hidden');}
    for(const button of document.querySelectorAll('[data-source-tab]')) {const active=button.dataset.sourceTab===type;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}
    $('#screenList').classList.toggle('hidden',type==='obs');$('#externalObsPanel').classList.toggle('hidden',type!=='obs');
    $('#btnConfirmShare').textContent=type==='obs'?'开始 OBS 共享':'确认共享';
    if(type==='obs'){void obsPanel().open();return;}externalObsPanel?.hide();
    if(!sourcesLoaded&&!sourcesLoading){void loadScreenSources();return;}
    const list=$('#screenList');list.replaceChildren();list.scrollTop=0;
    const screens=sourceInventory.filter(s=>(s.type||'screen')===type);
    for (const screen of screens) {
      const item = document.createElement('button'); item.type='button';item.className = 'screen-item';item.setAttribute('aria-pressed',String(state.selectedSourceId===screen.id&&state.selectedSourceType===screen.type));
      item.classList.toggle('selected',state.selectedSourceId===screen.id&&state.selectedSourceType===screen.type);
      const preview=document.createElement('span');preview.className='screen-preview';
      if(typeof screen.thumbnail==='string'&&screen.thumbnail.startsWith('data:image/')){const image=document.createElement('img');image.src=screen.thumbnail;image.alt='';image.draggable=false;image.onerror=()=>{image.remove();preview.classList.add('unavailable');preview.textContent='暂无预览';};preview.append(image);}
      else {preview.classList.add('unavailable');preview.textContent='暂无预览';}
      const label=document.createElement('span');label.className='screen-source-name';label.textContent=screen.name;item.title=screen.name;item.append(preview,label);
      item.onclick = () => {
        $$('.screen-item').forEach(el => {el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
        item.classList.add('selected');item.setAttribute('aria-pressed','true');state.selectedSourceId = screen.id;
        state.selectedSourceType = screen.type || 'screen';
        $('#btnConfirmShare').classList.remove('hidden');
      };
      list.appendChild(item);
    }
    if (!screens.length) list.textContent = type==='window'?'没有可共享的程序窗口':'没有可共享的屏幕';
}
export function openScreenPicker() {
  if(!state.channelId)return toast('请先加入频道后再共享屏幕');
  if(state.startingShare||state.stoppingShare||state.leaving||state.switchingChannel||state.isSharing||state.shareCleanupFailed)return;
  $('#screenPicker').classList.remove('hidden');$('#btnCancelPicker').focus();void loadScreenSources();
}
export function buildScreenConfig() {
  return {
    sourceId: state.selectedSourceId, sourceType: state.selectedSourceType,
    resolution: state.resolution,
    frameRate: state.frameRate,
    captureMethod: state.captureMethod, videoEncoder: state.videoEncoder,
    maxBitrate: state.maxBitrate,
    shareAudio: state.shareAudio,
    audioBitrate: state.audioBitrate,
  };
}
export async function startScreenCapture() {
  if (state.startingShare || state.stoppingShare || state.shareCleanupFailed || state.isSharing || state.leaving || state.switchingChannel) return;
  if (!socket?.connected || !state.roomId) return toast('请先连接服务器', 'error');
  if (!state.channelId) return toast('请先加入频道', 'error');
  if (state.selectedSourceId == null) return toast('请选择显示器或窗口', 'error');
  const current = ++sharingGeneration;externalObsSessionId=null;
  state.startingShare = true;state.pendingShareRelay=state.useServerRelay;updateSharingUI(false);
  try {
    const config = buildScreenConfig();
    if(state.useServerRelay){
      if(!state.videoRelay?.ready)throw Error(state.videoRelay?.message||'服务器未启用视频转发');
      config.videoRelay=await requestServer('prepare-relay-share');
      if(current!==sharingGeneration||!state.roomId||!socket?.connected)return;
    }
    const adaptiveResolution = state.adaptiveResolution;
    const result = await window.electronAPI.startSharing(config);
    if (current !== sharingGeneration || !state.roomId || !socket?.connected) return;
    if(config.videoRelay){
      state.activeShareRelay={host:config.videoRelay.host,port:config.videoRelay.port,path:config.videoRelay.path,...(config.videoRelay.transport==='direct'?{transport:'direct',url:config.videoRelay.url}:{})};
      await requestServer('start-sharing',{relayPath:config.videoRelay.path});
      if(current!==sharingGeneration||!state.roomId||!socket?.connected)return;
    }
    state.isSharing = true; updateSharingUI(true);
    externalObsSessionId=result?.externalObsSessionId||null;
    const [fallbackWidth, fallbackHeight] = config.resolution === 'auto' ? [1920,1080] : config.resolution.split('x').map(Number);
    shareAdaptation?.close();
    shareAdaptation = adaptiveResolution && config.sourceType!=='obs' ? createShareAdaptation({ base: config, width: result?.width || fallbackWidth, height: result?.height || fallbackHeight,
      bitrate: result?.bitrate || config.maxBitrate || 1500, change: (next, previous) => adjustShareQuality(current, next, previous) }) : null;
    $('#screenPicker').classList.add('hidden');
    if(!config.videoRelay)socket.emit('start-sharing');
    if (state.autoPreview) void displayRemoteVideo(socket.id);
  } catch (error) {
    if (current === sharingGeneration) {const message=error.message.replace(/^Error invoking remote method 'start-sharing': (?:Error: )?/,'');if(state.selectedSourceType==='obs')externalObsPanel?.error(message);await stopSharing({reportErrors:false});toast(message, 'error'); }
  } finally { state.startingShare = false;state.pendingShareRelay=false;updateSharingUI(state.isSharing); }
}
async function adjustShareQuality(token, next, previous) {
  const active = () => token === sharingGeneration && state.isSharing && !state.leaving && !state.switchingChannel && !!socket?.connected;
  if (!active()) return false;
  state.adjustingShare = true; updateSharingUI(true);
  try {
    await window.electronAPI.stopSharing(); if (!active()) return false;
    if(next.videoRelay)next={...next,videoRelay:await requestServer('prepare-relay-share')};
    if(!active())return false;
    await window.electronAPI.startSharing(next); return active();
  } catch (error) {
    if (!active()) return false;
    try { if(previous.videoRelay)previous={...previous,videoRelay:await requestServer('prepare-relay-share')};if(!active())return false;await window.electronAPI.startSharing(previous); }
    catch { if (active()) { await stopSharing(); toast(`共享画质调整失败：${error.message}`, 'error'); } }
    return false;
  } finally { state.adjustingShare = false; updateSharingUI(state.isSharing); }
}
export function receiveShareFeedback({ from, metrics }) {
  if (state.isSharing && !state.adjustingShare && state.serverUsers.some(user => user.socketId === from && user.watchingId === socket?.id)) void shareAdaptation?.report(from, metrics);
}
export function stopSharing({ reportErrors = true } = {}) {
  if (stoppingPromise) return stoppingPromise;
  const stoppedSocket=socket,stoppedRoom=state.roomId;
  sharingGeneration++; state.isSharing = false;state.pendingShareRelay=false;state.activeShareRelay=null;state.selectedSourceId = null;externalObsSessionId=null;
  shareAdaptation?.close(); shareAdaptation = null;
  state.stoppingShare = true;
  updateSharingUI(false); stopWatch();
  $('#btnConfirmShare').classList.add('hidden');
  stoppingPromise = Promise.resolve().then(() => window.electronAPI.stopSharing()).then(() => {
    state.shareCleanupFailed = false;
    return true;
  }, error => {
    state.shareCleanupFailed = true;
    if (reportErrors) toast(`共享清理未完成，请重试停止：${error.message}`, 'error');
    return false;
  }).finally(() => {
    // Let OBS finish its WHIP DELETE before the server revokes the publisher.
    if(socket===stoppedSocket&&state.roomId===stoppedRoom)stoppedSocket?.emit('stop-sharing');
    state.stoppingShare = false; stoppingPromise = null;
    updateSharingUI(state.isSharing);
  });
  return stoppingPromise;
}
export async function externalObsEnded({message,sessionId}={}){
  if(state.selectedSourceType!=='obs'||(!state.isSharing&&!state.startingShare)||externalObsSessionId&&externalObsSessionId!==sessionId)return;
  await stopSharing();if(message)toast(message,'error');
}
export function updateSharingUI(sharing) {
  const showStop = sharing || state.stoppingShare || state.shareCleanupFailed;
  const busy = state.startingShare || state.stoppingShare || state.leaving || state.switchingChannel || state.adjustingShare;
  $('#btnShare').classList.toggle('hidden', showStop || !state.channelId);
  $('#btnRoomSettingsToolbar').classList.toggle('hidden',!state.channelId);
  document.querySelectorAll('.card-share-button').forEach(button=>{button.disabled=busy||showStop;});
  $('#btnShare').disabled = busy || !state.channelId;
  $('#btnConfirmShare').disabled = busy || state.shareCleanupFailed;
  $('#btnStopShare').classList.toggle('hidden', !showStop);
  $('#btnStopShare').disabled = state.stoppingShare || state.leaving;
  $('#btnStopShare').textContent = state.stoppingShare ? '正在停止…' : state.shareCleanupFailed ? '重试停止' : '停止共享 ';
}
function reportViewing(context) {
  if (watchContext !== context || context.isSelf) return;
  const connected = state.watchingId === context.target && context.current.pc.connectionState === 'connected';
  if (context.reported === connected) return;
  context.reported = connected;
  socket?.emit(connected ? 'request-view' : 'stop-viewing', { target: context.target });
}
export function validateRetainedWatch() {
  if (!watchContext) return;
  const user = roomUsers.get(watchContext.target);
  if (watchContext.room !== state.roomId || watchContext.channel !== state.channelId
    || (watchContext.isSelf ? !state.isSharing||JSON.stringify(state.activeShareRelay)!==watchContext.relayKey : !user?.isSharing || JSON.stringify(user.videoRelay||null)!==watchContext.relayKey || !watchContext.relay&&user.virtualIp !== watchContext.host)) stopWatch();
}
export async function displayRemoteVideo(targetSocketId) {
  const targetUser = roomUsers.get(targetSocketId);
  const isSelf = targetSocketId === socket?.id;
  const relay=isSelf?state.activeShareRelay:targetUser?.videoRelay||null;
  const valid = isSelf ? state.isSharing : targetUser?.isSharing && (relay||/^\d{1,3}(\.\d{1,3}){3}$/.test(targetUser.virtualIp));
  if (!valid) { stopWatch(); return toast('共享者地址不可用', 'error'); }
  const reusable = retainWatchTimer !== null && watchContext?.target === targetSocketId
    && watchContext.room === state.roomId && watchContext.channel === state.channelId
    && watchContext.host === (relay?.host||(isSelf ? '127.0.0.1' : targetUser.virtualIp))&&watchContext.relayKey===JSON.stringify(relay)
    && !session.closed && !['failed', 'closed', 'disconnected'].includes(session.pc.connectionState);
  if (!reusable) stopWatch();
  else { clearTimeout(retainWatchTimer); retainWatchTimer = null; }
  state.watchingId = targetSocketId;
  renderViewerNames();
  $('#userCardsView').classList.add('hidden'); $('#activeVideoView').classList.remove('hidden');
  const container = $('#videoContainer');
  container.innerHTML = '<video autoplay playsinline controls></video><div id="watchConnectionStatus" class="watch-connection-status hidden" role="status"></div><div class="pip-bar"><button id="btnPip">画中画</button></div>';
  const video = container.querySelector('video');
  video.muted = isSelf; video.defaultMuted = isSelf;
  $('#btnPip').onclick = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); }
    catch (error) { toast(`画中画开启失败：${error.message}`, 'error'); }
  };
  if (reusable) {
    watchContext.video = video; video.srcObject = watchContext.stream;
    disposeStats = attachVideoStats(container, session.pc);
    if (watchContext.stream.getTracks().length) video.play().catch(() => { if (watchContext?.video === video) toast('请点击视频播放按钮'); });
    reportViewing(watchContext); watchContext.startFeedback?.(); return;
  }
  const context = { target: targetSocketId, isSelf, room: state.roomId, channel: state.channelId,
    relay,relayKey:JSON.stringify(relay),host: relay?.host||(isSelf ? '127.0.0.1' : targetUser.virtualIp), stream: new MediaStream(), video, reported: false,
    retries: 0, retryTimer: null, disconnectTimer: null, connectedAt: null, feedbackStop: null };
  watchContext = context;
  const message = text => {
    if (watchContext !== context || state.watchingId !== context.target) return;
    const status = $('#watchConnectionStatus'); status.textContent = text;
    status.classList[text ? 'remove' : 'add']('hidden');
  };
  const connect = async () => {
    if (watchContext !== context) return;
    const fail = error => {
      if (watchContext !== context || context.current !== current || context.retryTimer !== null) return;
      clearTimeout(context.disconnectTimer); context.disconnectTimer = null;
      const visible = state.watchingId === context.target;
      if (context.connectedAt !== null && Date.now() - context.connectedAt >= 15000) context.retries = 0;
      context.connectedAt = null;
      current.close(); reportViewing(context);
      context.feedbackStop?.(); context.feedbackStop = null;
      disposeStats?.(); disposeStats = null;
      context.stream.getTracks().forEach(track => track.stop()); context.stream = new MediaStream();
      if (context.video) context.video.srcObject = null;
      if (!visible || context.retries >= 5) {
        stopWatch(); if (visible) toast(`观看重连失败，请重新观看：${error.message}`, 'error'); return;
      }
      context.retries++;
      message(`网络中断，正在重连（${context.retries}/5）…`);
      context.retryTimer = setTimeout(() => {
        context.retryTimer = null; validateRetainedWatch();
        if (watchContext === context && state.watchingId === context.target) void connect();
      }, Math.min(5000, 800 * 2 ** (context.retries - 1)));
    };
    const relayOrigin=relay?.transport==='direct'?relay.url:`http://${context.host}:${relay?.port||8889}`;
    const current = context.current = new WhepSession(`${relayOrigin}/${relay?.path||'live'}/whep`, getIceServers(), event => {
      if (watchContext !== context || context.current !== current || current.closed) return;
      context.stream.addTrack(event.track);
      const activeVideo = context.video; if (!activeVideo) return;
      activeVideo.srcObject = context.stream;
      activeVideo.play().catch(() => { if (context.video === activeVideo) toast('请点击视频播放按钮'); });
    }, fail,{directRelay:relay?.transport==='direct',...(state.noTun&&relay?.transport!=='direct'?{tunnel:createMediaTunnel(context.isSelf&&!relay?state.virtualIp:context.host,true),virtualIp:state.virtualIp}:{}),...(relay?{getToken:async()=>{const result=await requestServer('get-relay-view',{target:context.target});if(watchContext!==context||result.path!==relay.path||result.host!==relay.host||result.port!==relay.port||result.transport!==relay.transport||result.url!==relay.url)throw Error('转发会话已变化，请重新观看');return result.token;}}:{})});
    session = current;
    context.startFeedback = () => {
      if (context.isSelf || context.feedbackStop || watchContext !== context || state.watchingId !== context.target) return;
      context.feedbackStop = watchNetwork(current.pc, metrics => {
        if (watchContext === context && context.current === current && state.watchingId === context.target && socket?.connected) socket.emit('watch-feedback', { target: context.target, metrics });
      });
    };
    const connectionChanged = () => {
      if (watchContext !== context || context.current !== current || current.closed) return;
      reportViewing(context);
      if (current.pc.connectionState === 'connected') {
        clearTimeout(context.disconnectTimer); context.disconnectTimer = null;
        context.connectedAt ??= Date.now(); message('');
        context.startFeedback();
      } else if (current.pc.connectionState === 'disconnected' && context.disconnectTimer === null) {
        message('网络波动，正在恢复…');
        context.disconnectTimer = setTimeout(() => {
          context.disconnectTimer = null;
          if (current.pc.connectionState === 'disconnected') fail(new Error('媒体连接中断'));
        }, 4000);
      }
    };
    current.pc.addEventListener('connectionstatechange', connectionChanged);
    disposeStats = attachVideoStats(container, current.pc);
    if (!context.retries) message('正在连接共享画面…');
    try { await current.start(); connectionChanged(); } catch (error) { fail(error); }
  };
  await connect();
}
export function renderViewerNames() {
  const viewers = state.serverUsers.filter(u => u.watchingId === state.watchingId && u.socketId !== state.watchingId);
  $('#viewerNames').textContent = viewers.length ? `观众（${viewers.length}）：${viewers.map(u => u.name).join('、')}` : '观众（0）：暂无观众';
}
export function stopWatch({ retain = false } = {}) {
  disposeStats?.(); disposeStats = null;
  const context = watchContext;
  if (context) { context.feedbackStop?.(); context.feedbackStop = null; }
  if (context) { clearTimeout(context.retryTimer); clearTimeout(context.disconnectTimer); context.retryTimer = context.disconnectTimer = null; }
  state.watchingId = null;
  if (context) reportViewing(context);
  const video = context?.video || $('#videoContainer').querySelector('video');
  if (video) { video.pause(); video.muted = true; video.srcObject = null; }
  if (context) context.video = null;
  if (retain && session && !session.closed && context && state.roomId === context.room && state.channelId === context.channel) {
    if (retainWatchTimer === null) retainWatchTimer = setTimeout(() => { if (watchContext === context) stopWatch(); }, 10000);
  } else {
    clearTimeout(retainWatchTimer); retainWatchTimer = null;
    session?.close(); session = null; watchContext = null;
    context?.stream.getTracks().forEach(track => track.stop());
  }
  $('#viewerNames').textContent = '';
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  $('#activeVideoView').classList.add('hidden'); $('#userCardsView').classList.remove('hidden');
  $('#videoContainer').innerHTML = '';
}
