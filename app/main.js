const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const osn = require('obs-studio-node'); // 请确保 npm install obs-studio-node 并编译成功

let mainWindow = null;
let easytierProcess = null;
let mediamtxProcess = null;

let isObsInitialized = false;
let obsScene = null;
let obsDisplaySource = null;
let obsStreaming = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.key === 'f12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ============================================================
// EasyTier P2P 组网控制
// ============================================================
ipcMain.handle('start-easytier', (event, roomId) => {
  return new Promise((resolve, reject) => {
    if (easytierProcess) easytierProcess.kill();

    // 1. 本地直接生成随机的虚拟 IP (避免正则解析日志，解决获取不到 IP 的痛点)
    // 生成 10.144.X.X 格式的 IP，极大概率不会和本地真实网段冲突
    const vip = `10.144.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

    const exePath = app.isPackaged
      ? path.join(process.resourcesPath, 'easytier-core.exe')
      : path.join(__dirname, 'res', 'easytier-core.exe');

    console.log(`[Main] 尝试启动 EasyTier，路径: ${exePath}`);

    // 2. 补充核心组网参数：
    // --ipv4 : 强制指定 IP 并创建虚拟网卡
    // -e     : 接入官方公共节点，用于跨公网的 P2P 发现和打洞
    const args = [
      '--ipv4', vip,
      '--network-name', `screensh-${roomId}`,
      '--network-secret', 'screensh-p2p',
      '-e', 'tcp://hhh.591.world:11010'
    ];

    easytierProcess = spawn(exePath, args);

    easytierProcess.on('error', (err) => {
      console.error(`❌ [EasyTier 启动失败]:`, err.message);
      resolve(vip);
    });

    easytierProcess.stdout.on('data', (data) => {
      console.log(`[EasyTier]: ${data.toString().trim()}`);
    });

    easytierProcess.stderr.on('data', (data) => {
      console.log(`[EasyTier Warn]: ${data.toString().trim()}`);
    });

    // ==========================================
    // 【修改点】：替换掉原来的 setTimeout，改为日志监听 + 兜底放行
    // ==========================================
    let isResolved = false;
    easytierProcess.stdout.on('data', (data) => {
      const log = data.toString().trim();
      console.log(`[EasyTier]: ${log}`);

      // 监听成功标志 (如果有 ready, tun 或 success 等字眼说明网卡挂载成功)
      if (!isResolved && (log.toLowerCase().includes('ready') || log.toLowerCase().includes('tun') || log.toLowerCase().includes('success'))) {
        isResolved = true;
        resolve(vip);
      }
    });

    // 兜底逻辑：如果日志格式变了没匹配到，5秒后强制放行，避免前端永远卡住
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        console.log(`[EasyTier] 启动日志未匹配，超时兜底放行`);
        resolve(vip);
      }
    }, 5000);
    // ==========================================
  });
});

ipcMain.on('stop-easytier', () => {
  if (easytierProcess) easytierProcess.kill();
});

// ============================================================
// MediaMTX 流媒体服务器控制
// ============================================================
ipcMain.on('start-mediamtx', () => {
  if (mediamtxProcess) return;
  const exePath = app.isPackaged
    ? path.join(process.resourcesPath, 'mediamtx.exe')
    : path.join(__dirname, 'res', 'mediamtx.exe');
  mediamtxProcess = spawn(exePath, []);
  console.log('[MediaMTX] Started');
});

ipcMain.on('stop-mediamtx', () => {
  if (mediamtxProcess) {
    mediamtxProcess.kill();
    mediamtxProcess = null;
  }
});

// ============================================================
// 新增：获取系统显示器列表
// ============================================================
ipcMain.handle('get-screens', () => {
  const displays = screen.getAllDisplays();
  // id 对应 OBS 的 monitor_capture 索引
  return displays.map((d, i) => ({
    id: i,
    name: `显示器 ${i + 1} (${d.size.width}x${d.size.height})`
  }));
});

// ============================================================
// OBS Studio Node 初始化函数 (v0.26.26 API)
// ============================================================
function initOBS() {
  if (isObsInitialized) return;

  console.log('[OBS] 开始初始化核心引擎...');

  // 1. 设置 IPC 和工作目录
  osn.NodeObs.IPC.host('obs-screensh');

  const osnPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'obs-studio-node')
    : path.join(__dirname, 'node_modules', 'obs-studio-node');

  osn.NodeObs.SetWorkingDirectory(osnPath);

  // 2. 初始化 OBS API
  const obsDataPath = path.join(app.getPath('userData'), 'obs-data');

  // 🚨【关键修复】确保 OBS 数据目录存在，否则 OBS 底层会直接报 -1 错误
  if (!fs.existsSync(obsDataPath)) {
    console.log('[OBS] 数据目录不存在，正在创建:', obsDataPath);
    fs.mkdirSync(obsDataPath, { recursive: true });
  }

  const initResult = osn.NodeObs.OBS_API_initAPI('zh-CN', obsDataPath, '1.0.0');
  if (initResult !== 0) {
    console.error('❌ [OBS] API 初始化失败，错误码:', initResult);
    return;
  }

  // 3. 全局视频参数配置 (v0.26.26: OBS_service_setVideoInfo)
  osn.NodeObs.OBS_service_setVideoInfo({
    fpsNum: 30,
    fpsDen: 1,
    baseWidth: 1920,
    baseHeight: 1080,
    outputWidth: 1920,
    outputHeight: 1080,
    outputFormat: 1,
    colorspace: 1,
    range: 1,
    scaleType: 0,
  });

  // 4. 全局音频参数配置 (v0.26.26: OBS_service_resetAudioContext)
  osn.NodeObs.OBS_service_resetAudioContext({
    samplesPerSec: 48000,
    speakers: 2,
  });

  isObsInitialized = true;
  console.log('✅ [OBS] 核心引擎初始化成功');
}

// ============================================================
// OBS 屏幕捕获与推流 (动态接收设置)
// ============================================================
ipcMain.on('start-obs-whip', (event, config) => {
  if (!isObsInitialized) initOBS();

  // 🚨【关键修复】如果初始化仍然失败（未就绪），直接阻断执行，防止引发 Invalid argument 崩溃！
  if (!isObsInitialized) {
    console.error('❌ [OBS] 引擎未就绪，放弃推流任务。请检查系统依赖或重启软件。');
    return;
  }

  console.log('[OBS] 准备捕获屏幕并推流，应用用户配置:', config);

  // ==========================================
  // 【新增】：安全清理防泄漏，释放上一轮的资源
  // ==========================================
  if (obsStreaming) {
    obsStreaming.stop();
    obsStreaming.release();
    obsStreaming = null;
  }
  if (obsScene) { obsScene.release(); obsScene = null; }
  if (obsDisplaySource) { obsDisplaySource.release(); obsDisplaySource = null; }
  // 清理全局轨道，防止画面或声音串流
  osn.Global.setOutputSource(0, null);
  osn.Global.setOutputSource(1, null);
  // ==========================================

  // 解析动态参数
  let width = 1920, height = 1080;
  if (config.resolution && config.resolution !== 'auto') {
    [width, height] = config.resolution.split('x').map(Number);
  }
  const fps = config.frameRate || 30;
  const videoBitrate = config.maxBitrate || 2500;
  const audioBitrate = config.audioBitrate || 128;
  const monitorIndex = config.sourceId || 0;

  try {
    // 动态应用分辨率与帧率
    osn.NodeObs.OBS_service_setVideoInfo({
      fpsNum: fps,
      fpsDen: 1,
      baseWidth: width,
      baseHeight: height,
      outputWidth: width,
      outputHeight: height,
      outputFormat: 1,
      colorspace: 1,
      range: 1,
      scaleType: 0,
    });

    // 1. 创建场景与桌面捕获源
    obsScene = osn.SceneFactory.create('ScreenShareScene');
    obsDisplaySource = osn.InputFactory.create('monitor_capture', 'DesktopCapture', {
      monitor: monitorIndex,
    });
    obsScene.add(obsDisplaySource);
    osn.Global.setOutputSource(0, obsScene);

    // 2. 挂载音频源
    if (config.shareAudio) {
      const obsAudioSource = osn.InputFactory.create('wasapi_output_capture', 'DesktopAudio', {
        device_id: 'default'
      });
      // 轨道 1 负责音频输出
      osn.Global.setOutputSource(1, obsAudioSource);
    } else {
      // 修复：如果未勾选共享声音，显式清空轨道 1，防止二次推流时产生残留杂音
      osn.Global.setOutputSource(1, null);
    }

    // 3. 创建编码器 (应用码率)
    const videoEncoder = osn.VideoEncoderFactory.create('obs_x264', 'h264_encoder', {
      bitrate: videoBitrate,
    });
    const audioEncoder = osn.AudioEncoderFactory.create('ffmpeg_aac', 'aac_encoder', {
      bitrate: audioBitrate,
    });

    // 4. 创建推流服务
    const service = osn.ServiceFactory.create('whip_custom', 'whip_service', {
      server: 'http://127.0.0.1:8889/live/whip',
    });

    // 5. 创建推流对象
    obsStreaming = osn.SimpleStreamingFactory.create();
    obsStreaming.service = service;
    obsStreaming.videoEncoder = videoEncoder;
    if (config.shareAudio) obsStreaming.audioEncoder = audioEncoder;

    // 6. 启动推流
    obsStreaming.start();
    console.log('✅ [OBS] 推流成功启动');

  } catch (err) {
    console.error('❌ [OBS] 推流配置发生异常:', err);
  }
});

// ============================================================
// 停止推流与内存清理 (需要补充声音的清理)
// ============================================================
ipcMain.on('stop-obs-whip', () => {
  console.log('[OBS] 停止推流并清理资源...');
  if (obsStreaming) {
    obsStreaming.stop();
    obsStreaming.release();
    obsStreaming = null;
  }
  if (obsScene) { obsScene.release(); obsScene = null; }
  if (obsDisplaySource) { obsDisplaySource.release(); obsDisplaySource = null; }

  // 必须把占用的轨道清空，否则二次启动声音可能会失效
  osn.Global.setOutputSource(0, null);
  osn.Global.setOutputSource(1, null);
});

// --- 窗口控制 ---
ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close', () => { if (mainWindow) mainWindow.close(); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (easytierProcess) easytierProcess.kill();
  if (mediamtxProcess) mediamtxProcess.kill();
  app.quit();
});

// App 退出时，彻底关闭 OBS 引擎
app.on('will-quit', () => {
  if (isObsInitialized) {
    console.log('[OBS] 正在安全关闭 OBS 引擎...');
    osn.NodeObs.OBS_API_destroyOBS_API();
  }
});
