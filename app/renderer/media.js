// ============================================================
// ScreenSh — 屏幕捕获 + 视频画面渲染
// ============================================================
import { state, $, $$ } from './shared.js';
import { toast } from './toast.js';
import { socket, peerConnections, offerToPeer } from './signaling.js';
// 用于 WebCodecs 虚拟音轨封装的控制变量
let audioWriter = null;
let customAudioTrack = null;
let audioBaseTime = 0; 

//音频数据缓冲区和全局帧数记录，防止 IPC 管道截断导致串音和爆音
// 使用预分配的固定大小线性缓冲区，零运行时堆内存分配
const MAX_AUDIO_BUFFER_SIZE = 256 * 1024;
const audioLinearBuffer = new Uint8Array(MAX_AUDIO_BUFFER_SIZE);
let audioBufferLength = 0;
let totalFrames = 0;

// --- 工具 ---
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- 屏幕捕获 ---

export async function loadScreenSources() {
  const sources = await window.electronAPI.getScreenSources();
  const list = $('#screenList');
  list.innerHTML = '';

  if (sources.length === 0) {
    list.innerHTML = '<p style="color:var(--text2);font-size:13px;padding:10px;">未检测到屏幕/窗口</p>';
    return;
  }

  sources.forEach((source) => {
    const item = document.createElement('div');
    item.className = 'screen-item';
    item.innerHTML = `
      <img src="${source.thumbnail}" alt="" />
      <span class="screen-name">${escapeHtml(source.name)}</span>
    `;
    item.addEventListener('click', () => {
      $$('.screen-item').forEach((el) => el.classList.remove('selected'));
      item.classList.add('selected');
      state.selectedSourceId = source.id;
      $('#btnConfirmShare').classList.remove('hidden');
    });
    list.appendChild(item);
  });
}

// 构建并组装外部独立音轨到 WebRTC 中
function initCustomAudioTrack() {
  if (customAudioTrack) return customAudioTrack;

  const generator = new MediaStreamTrackGenerator({ kind: 'audio' });
  audioWriter = generator.writable.getWriter();
  customAudioTrack = generator;

  window.electronAPI.onWindowAudioData((chunk) => {
    if (!audioWriter || !state.isSharing) return;
    if (audioBufferLength + chunk.length > MAX_AUDIO_BUFFER_SIZE) {
      console.warn('[Renderer] 音频环形缓冲区溢出，强制重置');
      audioBufferLength = 0;
    }
    audioLinearBuffer.set(chunk, audioBufferLength);
    audioBufferLength += chunk.length;
    const validBytes = Math.floor(audioBufferLength / 4) * 4;
    if (validBytes === 0) {
      return;
    }
    const s16Samples = new Int16Array(
      audioLinearBuffer.buffer,
      0,
      validBytes / 2
    );

    const timestampUs = Math.floor((totalFrames / 48000) * 1000000);
    totalFrames += validBytes / 4;

    try {
      const audioFrame = new AudioData({
        format: 's16',
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames: validBytes / 4,
        timestamp: timestampUs,
        data: s16Samples
      });
      audioWriter.write(audioFrame).catch((err) => console.error('[Renderer] 写入音频流失败:', err));
      audioFrame.close();
    } catch (err) {
      console.error('[Renderer] AudioData 创建失败:', err);
    }
    const remainder = audioBufferLength - validBytes;
    if (remainder > 0) {
      audioLinearBuffer.set(audioLinearBuffer.subarray(validBytes, audioBufferLength), 0);
    }
    audioBufferLength = remainder;
  });
  return customAudioTrack;
}

export async function startScreenCapture() {
  if (!state.selectedSourceId) {
    toast('请先选择一个屏幕源', 'error');
    return;
  }

  try {
    const isWindow = state.selectedSourceId.startsWith('window:');

    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: state.selectedSourceId,
        maxFrameRate: state.frameRate,
        minFrameRate: state.frameRate,
      },
    };

    if (state.resolution !== 'auto') {
      const [width, height] = state.resolution.split('x').map(Number);
      videoConstraints.mandatory.maxWidth = width;
      videoConstraints.mandatory.maxHeight = height;
    } else {
      videoConstraints.mandatory.maxWidth = 3840;
      videoConstraints.mandatory.maxHeight = 2160;
    }

    // 只有全屏共享时使用 Chromium 原生音频环回；窗口共享时强制设为 false
    let audioConstraints = false;
    if (state.shareAudio && !isWindow) {
      audioConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: state.selectedSourceId,
        }
      };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: videoConstraints,
    });
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
    }
    state.localStream = stream;
    state.isSharing = true;
    // 核心注入点：分享单独应用窗口且开启音频共享时，启动方案 B 底层工具
    if (state.shareAudio && isWindow) {
      window.electronAPI.startWindowAudio(state.selectedSourceId);
      const winAudioTrack = initCustomAudioTrack();
      state.localStream.addTrack(winAudioTrack);
      console.log(`[Renderer] 当前流轨道数量:`, state.localStream.getTracks());
    }

    stream.getTracks().forEach((track) => {
      track.onended = () => stopSharing();
    });

    socket.emit('start-sharing');

    updateSharingUI(true);
    toast('屏幕共享已开始', 'success');
  } catch (err) {
    console.error('Screen capture error:', err);
    toast('屏幕捕获失败: ' + err.message, 'error');
    updateSharingUI(false);
  }
}

export function stopSharing() {
  if (!state.localStream) return;
  const stream = state.localStream;
  state.localStream = null;
  state.isSharing = false;

  window.electronAPI.stopWindowAudio();
  window.electronAPI.removeWindowAudioListener();

  if (audioWriter) {
    audioWriter.close().catch(() => {});
    audioWriter = null;
  }
  customAudioTrack = null;
  audioBufferLength = 0;
  totalFrames = 0; 

  stream?.getTracks()?.forEach((track) => track.stop());

  Object.values(peerConnections).forEach((pc) => {
    const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      videoSender.replaceTrack(null).catch(() => {});
    }
    const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
    if (audioSender) {
      audioSender.replaceTrack(null).catch(() => {});
    }
  });

  socket.emit('stop-sharing');
  updateSharingUI(false);

  $('#btnStopWatch').click();
}

export function updateSharingUI(sharing) {
  if (sharing) {
    $('#btnShare').classList.add('hidden');
    $('#btnStopShare').classList.remove('hidden');
    $('#screenPicker').classList.remove('hidden');
    $('#screenPicker').classList.add('hidden');
  } else {
    $('#btnShare').classList.remove('hidden');
    $('#btnStopShare').classList.add('hidden');
    $('#screenPicker').classList.add('hidden');
    state.selectedSourceId = null;
    $$('.screen-item').forEach((el) => el.classList.remove('selected'));
    $('#btnConfirmShare').classList.add('hidden');
  }
}

// --- 视频画面 ---

export function displayLocalVideo(stream) {
  $('#userCardsView').classList.add('hidden');
  $('#activeVideoView').classList.remove('hidden');
  $('#watchingUserName').textContent = '你正在共享屏幕';

  const container = $('#videoContainer');
  container.innerHTML = `
    <video autoplay muted playsinline></video>
    <span style="position:absolute; top:12px; left:12px; background:var(--primary); padding:4px 10px; border-radius:20px; font-size:12px; color:#fff;">你的本地预览</span>
  `;
  container.querySelector('video').srcObject = stream;
}

export function displayRemoteVideo(socketId, stream) {
  if (state.watchingId !== socketId) return;

  const container = $('#videoContainer');
  let video = container.querySelector('video');

  // 只有在 video 不存在时才初始化 DOM 结构
  if (!video) {
    container.innerHTML = `
      <video autoplay playsinline></video>
      <button id="btnDebugInfo" class="debug-btn" title="查看调试信息">?</button>
      <div id="debugPanel" class="debug-panel hidden">
        <div class="debug-header">
          <span>WebRTC 调试信息</span>
          <button id="btnCloseDebug" class="btn-close-sm">×</button>
        </div>
        <div id="debugContent" class="debug-content">等待获取数据...</div>
      </div>
      <div class="pip-bar">
        <div class="volume-control" style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.65); padding: 0 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.2);">
          <span style="font-size: 12px; color: #fff; user-select: none;">🔊</span>
          <input type="range" id="volumeSlider" min="0" max="1" step="0.05" value="1" style="width: 65px; accent-color: var(--primary); cursor: pointer; height: 4px;" />
        </div>
        <button id="btnPiP">🗔 画中画</button>
        <button id="btnFullscreen">⛶ 全屏观看</button>
      </div>
    `;
    video = container.querySelector('video');

    // --- 音量、画中画、全屏绑定逻辑 ---
    const pipBtn = container.querySelector('#btnPiP');
    const fullscreenBtn = container.querySelector('#btnFullscreen');
    const volumeSlider = container.querySelector('#volumeSlider');

    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        if (video) video.volume = e.target.value;
      });
    }

    if (!document.pictureInPictureEnabled) {
      pipBtn.style.display = 'none';
    } else {
      pipBtn.addEventListener('click', async () => {
        try {
          if (!video) return;
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            await video.requestPictureInPicture();
          } else {
            video.addEventListener('loadedmetadata', async () => {
              await video.requestPictureInPicture();
            }, { once: true });
          }
        } catch (err) {
          toast('画中画失败: ' + err.message, 'error');
        }
      });

      video.addEventListener('enterpictureinpicture', () => {
        pipBtn.textContent = '返回';
        pipBtn.style.borderColor = 'var(--primary)';
      });

      video.addEventListener('leavepictureinpicture', () => {
        pipBtn.textContent = '🗔 画中画';
        pipBtn.style.borderColor = '';
      });
    }

    fullscreenBtn.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) await container.requestFullscreen();
        else await document.exitFullscreen();
      } catch (err) {
        toast('全屏失败: ' + err.message, 'error');
      }
    });

    container.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === container) {
        fullscreenBtn.textContent = '⛶ 退出全屏';
        fullscreenBtn.style.borderColor = 'var(--primary)';
        container.style.border = 'none';
        container.style.borderRadius = '0';
      } else {
        fullscreenBtn.textContent = '⛶ 全屏观看';
        fullscreenBtn.style.borderColor = '';
        container.style.border = '';
        container.style.borderRadius = '';
      }
    });

    // --- 调试面板展开/收起逻辑 ---
    const btnDebug = container.querySelector('#btnDebugInfo');
    const debugPanel = container.querySelector('#debugPanel');
    const btnCloseDebug = container.querySelector('#btnCloseDebug');

    btnDebug.addEventListener('click', () => {
      debugPanel.classList.remove('hidden');
      startDebugMonitor();
    });

    btnCloseDebug.addEventListener('click', () => {
      debugPanel.classList.add('hidden');
      stopDebugMonitor();
    });
  }

  if (video.srcObject !== stream) video.srcObject = stream;
  const volumeControl = container.querySelector('.volume-control');
  
  const updateVolumeVisibility = () => {
    if (volumeControl && stream) {
      const hasAudio = stream.getAudioTracks().length > 0;
      volumeControl.style.display = hasAudio ? 'flex' : 'none';
    }
  };
  updateVolumeVisibility();
  if (stream) {
    stream.onaddtrack = updateVolumeVisibility;
    stream.onremovetrack = updateVolumeVisibility;
  }
  // --- 调试面板核心监控逻辑 ---
  if (window.debugInterval) {
    clearInterval(window.debugInterval);
    window.debugInterval = null;
  }

  let lastResult = null;

  function stopDebugMonitor() {
    if (window.debugInterval) {
      clearInterval(window.debugInterval);
      window.debugInterval = null;
    }
    const content = container.querySelector('#debugContent');
    if (content) content.innerHTML = '已暂停检测';
  }

  function startDebugMonitor() {
    if (window.debugInterval) return;
    
    const content = container.querySelector('#debugContent');
    if (!content) return;

    content.innerHTML = '正在获取数据...';
    let lastResult = null;

    window.debugInterval = setInterval(async () => {
      if (container.querySelector('#debugPanel').classList.contains('hidden')) {
        stopDebugMonitor();
        return;
      }

      try {
        let stats = null;
        if (peerConnections[socketId]) {
          stats = await peerConnections[socketId].getStats();
        }

        if (!stats) return;

        let videoBitrate = 0, audioBitrate = 0, fps = 0, resolution = '未知';
        let rtt = 0, packetLoss = 0, videoCodec = '', audioCodec = '';

        stats.forEach(report => {
          if (report.type === 'inbound-rtp') {
            const isVideo = report.kind === 'video' || report.mediaType === 'video' || (report.id && report.id.toLowerCase().includes('video'));
            const isAudio = report.kind === 'audio' || report.mediaType === 'audio' || (report.id && report.id.toLowerCase().includes('audio'));

            let currentBitrate = 0;
            if (lastResult && lastResult.has(report.id)) {
              const lastR = lastResult.get(report.id);
              const timeDiffMs = report.timestamp - lastR.timestamp;
              if (timeDiffMs > 0 && report.bytesReceived >= lastR.bytesReceived) {
                currentBitrate = Math.floor(((report.bytesReceived - lastR.bytesReceived) * 8) / timeDiffMs);
              }
            }

            if (isVideo) {
              videoBitrate += currentBitrate;
              packetLoss += report.packetsLost || 0;
              
              const w = report.frameWidth || report.googFrameWidthReceived;
              const h = report.frameHeight || report.googFrameHeightReceived;
              if (w && h) resolution = `${w}x${h}`;
              
              if (report.framesPerSecond || report.googFrameRateReceived) {
                fps = report.framesPerSecond || report.googFrameRateReceived || fps;
              }
              
              if (report.codecId && stats.has(report.codecId)) {
                videoCodec = stats.get(report.codecId).mimeType?.split('/')[1] || videoCodec;
              }
            } else if (isAudio) {
              audioBitrate += currentBitrate;
              packetLoss += report.packetsLost || 0;
              if (report.codecId && stats.has(report.codecId)) {
                audioCodec = stats.get(report.codecId).mimeType?.split('/')[1] || audioCodec;
              }
            }
          }

          if (report.type === 'track' && (report.kind === 'video' || report.type === 'video')) {
            if (report.frameWidth && report.frameHeight) resolution = `${report.frameWidth}x${report.frameHeight}`;
            if (report.framesPerSecond) fps = report.framesPerSecond;
          }

          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime) rtt = (report.currentRoundTripTime * 1000).toFixed(0);
          } else if (report.type === 'inbound-rtp' && report.roundTripTime) {
            rtt = (report.roundTripTime * 1000).toFixed(0);
          }
        });

        lastResult = stats;

        const fpsColor = fps >= 24 ? '#0f0' : fps >= 15 ? '#ff0' : '#f00';
        const rttColor = rtt < 100 ? '#0f0' : rtt < 300 ? '#ff0' : '#f00';

        content.innerHTML = `
          <div>分 辨 率 : <span style="color:#fff">${resolution}</span></div>
          <div>视频帧率 : <span style="color:${fpsColor}">${fps} FPS</span></div>
          <div>视频码率 : <span style="color:#fff">${videoBitrate} kbps ${videoCodec ? `(${videoCodec})` : ''}</span></div>
          <div>音频码率 : <span style="color:#fff">${audioBitrate} kbps ${audioCodec ? `(${audioCodec})` : ''}</span></div>
          <div>网络延迟 : <span style="color:${rttColor}">${rtt} ms</span></div>
          <div>累计丢包 : <span style="color:#fff">${packetLoss}</span></div>
        `;
      } catch (e) { 
        console.error('Stats解析错误:', e); 
      }
    }, 1000);
  }

  // 流结束时的清理
  stream.getVideoTracks().forEach((track) => {
    track.onended = () => {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      stopDebugMonitor();
      $('#btnStopWatch').click();
    };
  });
}