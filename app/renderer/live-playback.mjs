// Live viewing always follows the current stream; only leaving stops playback.
export function attachLivePlayback(video, { onPlaybackBlocked = () => {} } = {}) {
  let disposed = false, pending = false, blocked = false;
  video.classList.add('live-video');
  video.setAttribute('aria-label', '直播画面');
  video.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
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
  };
}
