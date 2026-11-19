export function attachWatchPresentation(video, status) {
  let frameRequest = null, hasFrame = false;
  video.classList.add('watch-video');
  function setStatus(text) {
    if (!text && !hasFrame) return;
    status.textContent = text;
    status.hidden = !text;
  }
  function cancelFrameRequest() {
    if (frameRequest !== null) video.cancelVideoFrameCallback(frameRequest);
    frameRequest = null;
  }
  function reset(text) {
    cancelFrameRequest();
    hasFrame = false;
    video.classList.remove('watch-frame-ready');
    setStatus(text);
    frameRequest = video.requestVideoFrameCallback(() => {
      frameRequest = null;
      hasFrame = true;
      video.classList.add('watch-frame-ready');
      setStatus('');
    });
  }
  reset('正在连接共享画面…');
  return { setStatus, reset, dispose: cancelFrameRequest };
}

// Live viewing always follows the current stream; only leaving stops playback.
export function attachLivePlayback(video, { onPlaybackBlocked = () => {}, onFullscreenError = () => {} } = {}) {
  let disposed = false, pending = false, blocked = false;
  video.setAttribute('aria-label', '直播画面');
  video.controls = false;
  video.tabIndex = 0;

  const stage = video.parentElement;
  const controls = document.createElement('div');
  controls.className = 'live-video-controls';
  controls.innerHTML = `
    <span class="live-video-time">0:00</span>
    <button type="button" data-live-mute aria-label="静音">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Z"/><path data-volume-icon/></svg>
    </button>
    <input type="range" min="0" max="100" value="100" aria-label="播放音量">
    <button type="button" data-live-fullscreen aria-label="全屏">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg>
    </button>`;
  const time = controls.querySelector('.live-video-time');
  const mute = controls.querySelector('[data-live-mute]');
  const volume = controls.querySelector('input');
  const fullscreen = controls.querySelector('[data-live-fullscreen]');
  stage.append(controls);

  function syncVolume() {
    const silent = video.muted || video.volume === 0;
    volume.value = String(silent ? 0 : Math.round(video.volume * 100));
    mute.title = silent ? '取消静音' : '静音';
    mute.setAttribute('aria-label', mute.title);
    mute.querySelector('[data-volume-icon]').setAttribute('d', silent ? 'm16 9 5 6m0-6-5 6' : 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14');
  }
  function syncTime() {
    const seconds = Math.floor(video.currentTime);
    time.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function syncFullscreen() {
    const active = document.fullscreenElement === stage;
    fullscreen.title = active ? '退出全屏' : '全屏';
    fullscreen.setAttribute('aria-label', fullscreen.title);
    fullscreen.querySelector('path').setAttribute('d', active
      ? 'M3 9h6V3m12 6h-6V3M3 15h6v6m12-6h-6v6'
      : 'M9 3H3v6m12-6h6v6M9 21H3v-6m12 6h6v-6');
  }
  volume.oninput = () => {
    video.volume = Number(volume.value) / 100;
    video.muted = video.volume === 0;
  };
  mute.onclick = () => {
    if (!video.volume) { video.volume = 1; video.muted = false; }
    else video.muted = !video.muted;
  };
  fullscreen.onclick = async () => {
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else {
        await stage.requestFullscreen();
        if (disposed && document.fullscreenElement === stage) await document.exitFullscreen();
      }
    } catch (error) { if (!disposed) onFullscreenError(error); }
  };
  video.addEventListener('volumechange', syncVolume);
  video.addEventListener('timeupdate', syncTime);
  document.addEventListener('fullscreenchange', syncFullscreen);
  syncVolume();
  syncFullscreen();
  async function resume() {
    if (disposed || pending || !video.isConnected || !video.srcObject?.active || !video.paused) return;
    pending = true;
    try { await video.play(); blocked = false; }
    catch (error) {
      if (error.name !== 'AbortError' && !disposed && !blocked) { blocked = true; onPlaybackBlocked(); }
    } finally {
      pending = false;
      // A second pause can abort an in-flight play() before its pause event is handled.
      if (!disposed && !blocked && video.paused && video.srcObject?.active) queueMicrotask(resume);
    }
  }
  function keydown(event) {
    if (event.isComposing) return;
    if (event.key === 'Enter') void resume();
    if ([' ', 'k', 'K', 'Pause', 'MediaPause', 'MediaPlayPause'].includes(event.key)) event.preventDefault();
  }
  video.addEventListener('pause', resume);
  video.addEventListener('click', resume);
  video.addEventListener('keydown', keydown);
  return () => {
    disposed = true;
    video.removeEventListener('pause', resume);
    video.removeEventListener('click', resume);
    video.removeEventListener('keydown', keydown);
    video.removeEventListener('volumechange', syncVolume);
    video.removeEventListener('timeupdate', syncTime);
    document.removeEventListener('fullscreenchange', syncFullscreen);
    if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    controls.remove();
  };
}
