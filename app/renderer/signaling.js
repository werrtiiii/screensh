// ============================================================
// ScreenSh — 信令服务器连接 + WebRTC P2P 管理
// ============================================================
import { getIceServers, state, $ } from './shared.js';
import { toast } from './toast.js';
import { enterRoom, updateUserList, leaveRoom } from './room.js';
import { displayRemoteVideo } from './media.js';
export let socket = null;
export let peerConnections = {};

// --- 信令服务器连接 ---
export function connectServer() {
  const url = $('#serverUrl').value.trim() || 'http://localhost:3000';

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  socket = io(url, { transports: ['websocket', 'polling'], timeout: 10_000 });

  socket.on('connect', () => {
    $('#serverStatus').className = 'status-dot connected';
    toast('已连接到信令服务器', 'success');
  });

  socket.on('disconnect', () => {
    $('#serverStatus').className = 'status-dot disconnected';
    toast('与信令服务器断开连接', 'error');
    if (state.roomId) {
      leaveRoom();
    }
  });

  socket.on('connect_error', () => {
    $('#serverStatus').className = 'status-dot disconnected';
    toast('无法连接到信令服务器', 'error');
  });

  // --- 房间事件 ---
  socket.on('room-created', ({ roomId }) => {
    state.roomId = roomId;
    enterRoom(roomId);
  });

  socket.on('room-joined', ({ roomId, users }) => {
    state.roomId = roomId;
    enterRoom(roomId);
    updateUserList(users);
    users.forEach((u) => {
      if (u.socketId !== socket.id && !peerConnections[u.socketId]) {
        createPeerConnection(u.socketId);
      }
    });
  });

  socket.on('user-joined', ({ socketId, userName }) => {
    toast(`${userName} 加入了房间`);
    createPeerConnection(socketId);
  });

  socket.on('user-left', ({ socketId }) => {
    toast('有用户离开了房间');
    removePeerConnection(socketId);
  });

  socket.on('room-update', ({ users }) => updateUserList(users));

  socket.on('error', ({ message }) => toast(message, 'error'));

  // --- WebRTC 信令转发 ---
  socket.on('signal', async ({ from, data }) => {
    let pc = peerConnections[from];
    if (!pc) {
      pc = createPeerConnection(from);
    }
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          answer.sdp = enhanceOpusSdp(answer.sdp);
          await pc.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (err) {
      console.error('Signal processing error:', err);
    }
  });

  // 观看者请求视频/音频流
  socket.on('view-requested', ({ from }) => {
    if (state.isSharing && state.localStream) {
      const pc = peerConnections[from];
      if (pc) {
        const videoTrack = state.localStream.getVideoTracks()[0];
        if (!videoTrack) return;

        // ===== 升级：使用 transceiver 寻找通道类型，避免 track===null 时 kind 错位 =====
        const transceivers = pc.getTransceivers();
        const videoTransceiver = transceivers.find(t => t.receiver.track.kind === 'video');
        const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio');

        let videoSender = videoTransceiver ? videoTransceiver.sender : null;
        let audioSender = audioTransceiver ? audioTransceiver.sender : null;

        // 提取统一的应用编码和码率设置函数
        const applyParams = (sender) => {
          const capabilities = RTCRtpSender.getCapabilities('video');
          if (capabilities && capabilities.codecs) {
            let forcedCodecs = [];

            if (state.preferredCodec) {
              const [targetMime, targetFmtp] = state.preferredCodec.split('|');
              forcedCodecs = capabilities.codecs.filter(c => {
                const matchMime = c.mimeType.toLowerCase() === targetMime;
                const matchFmtp = targetFmtp ? (c.sdpFmtpLine === targetFmtp) : (!c.sdpFmtpLine);
                return matchMime && matchFmtp;
              });
            } else {
              const h264High = capabilities.codecs.filter(c => 
                c.mimeType.toLowerCase() === 'video/h264' && c.sdpFmtpLine && c.sdpFmtpLine.includes('64001f')
              );
              const h264Main = capabilities.codecs.filter(c => 
                c.mimeType.toLowerCase() === 'video/h264' && c.sdpFmtpLine && c.sdpFmtpLine.includes('4d001f')
              );
              const others = capabilities.codecs.filter(c => 
                !h264High.includes(c) && !h264Main.includes(c)
              );
              forcedCodecs = [...h264High, ...h264Main, ...others];
            }
            if (forcedCodecs.length > 0) {
              pc.getTransceivers().forEach(transceiver => {
                if (transceiver.sender === sender) {
                  try { transceiver.setCodecPreferences(forcedCodecs); } catch (e) {}
                }
              });
            }
          }
          try {
            const parameters = sender.getParameters();
            if (!parameters.encodings || parameters.encodings.length === 0) {
              parameters.encodings = [{}];
            }
            if (state.maxBitrate > 0) {
              parameters.encodings[0].maxBitrate = state.maxBitrate * 1000;
            } else {
              delete parameters.encodings[0].maxBitrate;
            }
            parameters.degradationPreference = 'maintain-framerate';
            sender.setParameters(parameters).catch(() => {});
          } catch (e) {}
        };

        const applyAudioParams = (sender) => {
          try {
            const parameters = sender.getParameters();
            if (!parameters.encodings || parameters.encodings.length === 0) {
              parameters.encodings = [{}];
            }
            parameters.encodings[0].maxBitrate = (state.audioBitrate || 128) * 1000;
            sender.setParameters(parameters).catch(() => {});
          } catch (e) {}
        };

        let needsNegotiation = false;

        // 1. 处理视频通道恢复或初始化
        if (videoSender) {
          videoSender.replaceTrack(videoTrack).then(() => {
            applyParams(videoSender);
          }).catch(err => console.error('替换视频轨道失败:', err));
        } else {
          pc.addTrack(videoTrack, state.localStream);
          const newSender = pc.getSenders().find(s => s.track === videoTrack);
          if (newSender) applyParams(newSender);
          needsNegotiation = true;
        }

        // 2. 新增：处理音频通道恢复或建立
        const audioTrack = state.localStream.getAudioTracks()[0];
        if (audioTrack) {
          if (audioSender) {
            audioSender.replaceTrack(audioTrack).then(() => {
              applyAudioParams(audioSender);
            }).catch(err => console.error('替换音频轨道失败:', err));
          } else {
            pc.addTrack(audioTrack, state.localStream);
            const newAudioSender = pc.getSenders().find(s => s.track === audioTrack);
            if (newAudioSender) applyAudioParams(newAudioSender);
            needsNegotiation = true;
          }
        } else {
          if (audioSender) {
            audioSender.replaceTrack(null).catch(() => {});
          }
        }

        if (needsNegotiation) {
          offerToPeer(from);
        }
      }
    }
  });

  // 观看者停止观看
  socket.on('view-stopped', ({ from }) => {
    const pc = peerConnections[from];
    if (pc) {
      // ===== 升级：将视频和音频通道的发流全部置为 null，瞬间切断带宽占用但维护 P2P 通道 =====
      const transceivers = pc.getTransceivers();
      const videoTransceiver = transceivers.find(t => t.receiver.track.kind === 'video');
      const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio');

      if (videoTransceiver && videoTransceiver.sender) {
        videoTransceiver.sender.replaceTrack(null).catch(() => {});
      }
      if (audioTransceiver && audioTransceiver.sender) {
        audioTransceiver.sender.replaceTrack(null).catch(() => {});
      }
    }
  });
  // --- 共享状态事件 ---
  socket.on('peer-sharing-started', ({ socketId }) => {
    toast('有人开始共享屏幕');
    state.activeSharerId = socketId;
  });

  socket.on('peer-sharing-stopped', ({ socketId }) => {
    toast('屏幕共享已结束');
    if (state.watchingId === socketId) {
      toast('共享已结束，已返回大厅', 'error');
      $('#btnStopWatch').click();
    }
    if (state.activeSharerId === socketId) state.activeSharerId = null;
  });
}

// ===== 强化 Opus 音频的 SDP（开启立体声 + 动态码率限制） =====
function enhanceOpusSdp(sdp) {
  const opusRegex = /a=rtpmap:(\d+)\s+opus\/48000\/2/i;
  const match = sdp.match(opusRegex);
  if (match && match[1]) {
    const pt = match[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+(.*)`);
    const bitrate = (state.audioBitrate || 128) * 1000;

    if (fmtpRegex.test(sdp)) {
      sdp = sdp.replace(fmtpRegex, `a=fmtp:${pt} $1;stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate}`);
    } else {
      sdp = sdp.replace(new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000\\/2\\r\\n)`), `$1a=fmtp:${pt} stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate}\r\n`);
    }
  }
  return sdp;
}

// --- WebRTC P2P 连接管理 ---

export function createPeerConnection(targetSocketId) {
  if (peerConnections[targetSocketId]) {
    return peerConnections[targetSocketId];
  }

  const pc = new RTCPeerConnection(getIceServers());
  peerConnections[targetSocketId] = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit('signal', {
        to: targetSocketId,
        data: { candidate: event.candidate },
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      console.log(`Connection to ${targetSocketId}: ${pc.connectionState}`);
    }
  };

  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      displayRemoteVideo(targetSocketId, remoteStream);
    }
  };

  return pc;
}

export function removePeerConnection(targetSocketId) {
  const pc = peerConnections[targetSocketId];
  if (pc) {
    pc.close();
    delete peerConnections[targetSocketId];
  }
  if (state.watchingId === targetSocketId) {
    $('#btnStopWatch').click();
  }
}

export function removeAllPeerConnections() {
  Object.keys(peerConnections).forEach((id) => removePeerConnection(id));
  peerConnections = {};
}

export async function offerToPeer(targetSocketId) {
  const pc = peerConnections[targetSocketId];
  if (!pc || !socket) return;

  try {
    const offer = await pc.createOffer();
    offer.sdp = enhanceOpusSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    socket.emit('signal', {
      to: targetSocketId,
      data: { sdp: pc.localDescription },
    });
  } catch (err) {
    console.error('Offer creation error:', err);
  }
}

export function disconnectSignaling() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
