const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { listCaptureSources } = require('./capture-sources');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { isIPv4 } = require('net');
const { randomInt } = require('crypto');
const { ManagedProcess } = require('./managed-process');
const { ObsEngine } = require('./obs-engine');

let mainWindow, obs, virtualIp, startingShare = false, generation = 0, quitting = false;
const resource = name => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, 'res'), name);
function failure(message) {
  console.error(message);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime-error', message);
}
const easytier = new ManagedProcess('EasyTier', failure);
const mediamtx = new ManagedProcess('MediaMTX', failure);
const peerTester = require('./peer-test').createPeerTester(resource('easytier-core.exe'));
ipcMain.handle('test-easytier-peer', (_event, peer) => peerTester.test(peer));
const addresses = () => Object.values(os.networkInterfaces()).flat().filter(Boolean).map(i => i.address);

function createWindow() {
  obs = new ObsEngine(path.join(app.getPath('userData'), 'obs'), failure);
  mainWindow = new BrowserWindow({ width: 1200, height: 800, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key.toLowerCase() === 'f12') {
      mainWindow.webContents.toggleDevTools(); event.preventDefault();
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

ipcMain.handle('start-easytier', async (_event, roomId, configuredPeers) => {
  if (typeof roomId !== 'string' || !/^[\p{L}\p{N}_-]{1,64}$/u.test(roomId)) throw new Error('房间号仅支持1至64位字母、数字、下划线和连字符');
  const { normalizePeers, DEFAULT_PEER } = await import('./renderer/easytier-peers.mjs');
  const peers = normalizePeers(configuredPeers ?? process.env.SCREENSH_EASYTIER_PEER ?? DEFAULT_PEER);
  await easytier.stop();
  virtualIp = null;
  // Optional LAN-only validation, without changing virtual adapters or contacting a relay.
  if (process.env.SCREENSH_LOCAL_IP) {
    const ip = process.env.SCREENSH_LOCAL_IP;
    if (!isIPv4(ip) || !addresses().includes(ip)) throw new Error('SCREENSH_LOCAL_IP 必须是本机网卡上的 IPv4 地址');
    return virtualIp = ip;
  }
  let ip;
  do { ip = `10.144.${randomInt(1, 255)}.${randomInt(1, 255)}`; } while (addresses().includes(ip));
  const exe = resource('easytier-core.exe');
  if (!fs.existsSync(resource('wintun.dll'))) throw new Error('缺少 Wintun：请把匹配 Windows x64 的 wintun.dll 放到 app/res 目录');
  try {
    // Addresses span 10.144.0.0/16. Without a prefix EasyTier defaults to /24,
    // sending other members' virtual IPs through the physical default gateway.
    await easytier.start(exe, ['-i', `${ip}/16`, '--network-name', `screensh-${roomId}`,
    '--network-secret', process.env.SCREENSH_NETWORK_SECRET || 'screensh-p2p',
    '-p', ...peers], {
    cwd: path.dirname(exe),
    probe: () => Object.values(os.networkInterfaces()).flat().some(i => i?.address === ip && i.cidr === `${ip}/16`),
    timeout: 20000,
  });
  } catch (error) {
    console.error('[EasyTier startup]', error);
    if (/Failed to create adapter|Access is denied|拒绝访问/i.test(error.message)) {
      throw new Error('EasyTier 无法创建虚拟网卡。请完全退出客户端，右键选择“以管理员身份运行”后重试。');
    }
    throw error;
  }
  return virtualIp = ip;
});

ipcMain.handle('get-screens', () => {
  obs.init();
  try { return listCaptureSources(obs.osn, screen.getAllDisplays()); }
  finally { obs.scheduleIdleShutdown(); }
});

function validateConfig(config) {
  if (!config || !((Number.isInteger(config.sourceId) && config.sourceId >= 0)
    || (typeof config.sourceId === 'string' && config.sourceId.length > 0 && config.sourceId.length <= 512))
    || !['screen', 'window'].includes(config.sourceType || 'screen')
    || (config.sourceType === 'window' && typeof config.sourceId !== 'string')
    || !['auto', 'wgc', 'dxgi'].includes(config.captureMethod ?? 'auto')
    || !['x264', 'nvenc', 'amf'].includes(config.videoEncoder ?? 'x264')
    || !['auto', '1920x1080', '1280x720', '854x480'].includes(config.resolution)
    || ![15, 30, 60].includes(config.frameRate)
    || !Number.isInteger(config.maxBitrate) || (config.maxBitrate !== 0 && (config.maxBitrate < 100 || config.maxBitrate > 10000))
    || ![32, 64, 128, 256].includes(config.audioBitrate) || typeof config.shareAudio !== 'boolean') throw new Error('共享设置无效');
}
async function stopShare() {
  generation++;
  obs?.stop();
  await mediamtx.stop();
}
ipcMain.handle('start-sharing', async (_event, config) => {
  validateConfig(config);
  if (!virtualIp) throw new Error('请先加入房间');
  if (startingShare || obs.streaming) throw new Error('共享正在启动或已启动');
  startingShare = true;
  const current = ++generation;
  try {
    const exe = resource('mediamtx.exe');
    await mediamtx.start(exe, [path.join(__dirname, 'mediamtx.yml')], {
      cwd: path.dirname(exe), ready: log => /\[WebRTC\] listener opened/.test(log),
      env: { ...process.env, MTX_WEBRTCADDITIONALHOSTS: virtualIp,
        MTX_WEBRTCIPSFROMINTERFACES: 'false', MTX_WEBRTCLOCALUDPADDRESS: `${virtualIp}:8189`,
        MTX_WEBRTCLOCALTCPADDRESS: `${virtualIp}:8189` },
    });
    if (current !== generation) throw new Error('共享启动已取消');
    const result = await obs.start(config);
    await mediamtx.waitForOutput(/\[path live\] stream is available/);
    if (current !== generation) throw new Error('共享启动已取消');
    return result;
  } catch (error) {
    await stopShare(); throw error;
  } finally { startingShare = false; }
});
ipcMain.handle('stop-sharing', stopShare);
ipcMain.handle('leave-runtime', async () => {
  await stopShare(); await easytier.stop(); virtualIp = null;
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close', () => mainWindow?.close());
// Fixed media ports mean a second local instance cannot safely share simultaneously.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    Promise.allSettled([stopShare(), easytier.stop(), peerTester.stop()]).finally(() => { obs?.shutdown(); app.quit(); });
  });
}

