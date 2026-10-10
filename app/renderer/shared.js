// ============================================================
// ScreenSh — 全局状态
// ============================================================
export const state = {
  roomId: null,
  userName: null,
  virtualIp: null, // 当前本机的 EasyTier VIP
  isSharing: false,
  startingShare: false,
  joining: false,
  leaving: false,
  watchingId: null,
  activeSharerId: null,

  // 新增：未完成的默认设置参数与选中屏幕状态
  selectedSourceId: null,
  selectedSourceType: 'screen',
  resolution: '1280x720',
  captureMethod: 'auto',
  videoEncoder: 'x264',
  autoPreview: true,
  frameRate: 30,
  maxBitrate: 1500,
  audioBitrate: 128,
  shareAudio: false,
  // EasyTier or the explicitly selected LAN address supplies the reachable route.
  stunServer: '',
  turnServer: ''
};

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function getIceServers() {
  const servers = [];
  if (state.stunServer) {
    servers.push({ urls: state.stunServer });
  }
  if (state.turnServer) {
    const parts = state.turnServer.split('|');
    servers.push({
      urls: parts[0],
      username: parts[1] || '',
      credential: parts[2] || ''
    });
  }
  return servers.length > 0 ? { iceServers: servers } : undefined;
}
