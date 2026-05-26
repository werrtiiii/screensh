// ============================================================
// ScreenSh — 全局状态 & 常量 & DOM 工具
// ============================================================

// 全局状态对象 — 所有模块通过引用共享，无需 setter
export const state = {
  roomId: null,
  userName: null,
  isSharing: false,
  localStream: null,
  selectedSourceId: null,
  watchingId: null,
  activeSharerId: null,
  preferredCodec: '',
  resolution: '1280x720',
  frameRate: 30,
  maxBitrate: 1000,
  audioBitrate: 128,
  stunServer: 'stun:stun.l.google.com:19302',
  turnServer: '',
  shareAudio: false,
};

export function getIceServers() {
  const servers = [];
  
  if (state.stunServer) {
    servers.push({ urls: state.stunServer.trim() });
  }

  if (state.turnServer) {
    const parts = state.turnServer.trim().split('|');
    if (parts.length > 0 && parts[0]) {
      servers.push({
        urls: parts[0],
        username: parts[1] || '',
        credential: parts[2] || '',
      });
    }
  }
  if (servers.length === 0) {
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  return { iceServers: servers };
}

// DOM 快捷选择器
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);