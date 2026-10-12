const path = require('path');
const fs = require('fs');
const C = require('./obs-constants');

class ObsEngine {
  constructor(dataPath, onFailure = () => {}, publishUrl = 'http://127.0.0.1:8889/live/whip') {
    this.dataPath = dataPath; this.onFailure = onFailure;
    this.publishUrl = publishUrl;
    this.resources = []; this.initialized = false; this.hosted = false;
  }
  init() {
    clearTimeout(this.idleTimer);
    if (this.initialized) return;
    // Load lazily so a missing native dependency does not prevent the UI opening.
    const o = this.osn = require('obs-studio-node');
    const bin = path.dirname(require.resolve('obs-studio-node/package.json'))
      .replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
    fs.mkdirSync(this.dataPath, { recursive: true });
    try {
      const oldCompatibility = process.env.__COMPAT_LAYER;
      let code;
      try {
        // The bundled OBS host lacks DPI awareness: WGC otherwise crops physical
        // window pixels to virtualized dimensions on scaled Windows displays.
        process.env.__COMPAT_LAYER = `${oldCompatibility || ''} HIGHDPIAWARE`.trim();
        code = o.NodeObs.IPC.host(`screensh-${process.pid}-${Date.now()}`);
      } finally {
        if (oldCompatibility === undefined) delete process.env.__COMPAT_LAYER;
        else process.env.__COMPAT_LAYER = oldCompatibility;
      }
      if (code !== 0) throw new Error(`OBS IPC 启动失败: ${code}`);
      this.hosted = true;
      o.NodeObs.SetWorkingDirectory(bin);
      const result = o.NodeObs.OBS_API_initAPI('zh-CN', this.dataPath.replace(/\\/g, '/'), '1.0.0', '');
      if (result !== 0) throw new Error(`OBS 初始化失败: ${result}`);
      this.initialized = true;
      o.Global.multipleRendering = false;
      o.AudioFactory.legacySettings = { sampleRate: 48000, speakers: C.Stereo };
    } catch (error) { this.shutdown(); throw error; }
  }
  own(value, dispose) { this.resources.push(() => dispose(value)); return value; }
  scheduleIdleShutdown() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.streaming) this.shutdown();
    }, 30000);
    this.idleTimer.unref?.();
  }
  createSource(config) {
    if (config.sourceType === 'window') {
      return this.osn.InputFactory.create('window_capture', `window-${Date.now()}`, {
        window: config.sourceId, method: 2, priority: 0, cursor: true, capture_audio: false,
      });
    }
    const settings = typeof config.sourceId === 'string' ? { monitor_id: config.sourceId } : { monitor: config.sourceId };
    settings.method = { auto: 0, dxgi: 1, wgc: 2 }[config.captureMethod || 'auto'];
    if (settings.method === undefined) throw new Error('整屏采集方式无效');
    return this.osn.InputFactory.create('monitor_capture', `screen-${Date.now()}`, settings);
  }
  async start(config) {
    if (this.streaming) throw new Error('OBS 正在共享');
    this.init();
    const generation = this.generation = (this.generation || 0) + 1;
    const o = this.osn;
    try {
      if (!o.ServiceFactory.types().includes('whip_custom')) throw new Error('当前 OBS 不包含 WHIP 服务插件');
      let width = config.resolution === 'auto' ? 1920 : Number(config.resolution.split('x')[0]);
      let height = config.resolution === 'auto' ? 1080 : Number(config.resolution.split('x')[1]);
      const video = this.own(o.VideoFactory.create(), v => v.destroy());
      const videoSettings = {
        fpsNum: config.frameRate, fpsDen: 1, baseWidth: width, baseHeight: height,
        outputWidth: width - width % 2, outputHeight: height - height % 2,
        outputFormat: C.NV12, colorspace: C.CS709,
        range: C.Partial, scaleType: C.Bicubic, fpsType: C.CommonFPS,
      };
      video.video = videoSettings;
      const source = this.own(this.createSource(config), s => s.release());
      if (config.sourceType === 'window' && config.shareAudio && !o.InputFactory.types().includes('wasapi_process_output_capture')) {
        throw new Error('当前系统或 OBS 不支持程序音频采集，请关闭共享音频后重试；不会自动改为采集系统声音');
      }
      const scene = this.own(o.SceneFactory.create(`share-${Date.now()}`), s => s.release());
      // Remove the scene item before releasing sources so capture is deactivated.
      const item = this.own(scene.add(source), item => item.remove());
      item.video = video;
      item.visible = true;
      item.streamVisible = true;
      let resizeFilter;
      // Fit the entire source into a stable output canvas, preserving aspect ratio.
      const fit = () => {
        if (!(source.width > 0 && source.height > 0)) return;
        const scale = Math.min(width / source.width, height / source.height);
        item.transformInfo = {
          pos: { x: (width - source.width * scale) / 2, y: (height - source.height * scale) / 2 },
          rot: 0, scale: { x: scale, y: scale }, alignment: 5,
          boundsType: 0, boundsAlignment: 0, bounds: { x: 0, y: 0 },
        };
        // Keep the binding's individual transform properties in sync as well.
        item.scale = { x: scale, y: scale };
        item.position = { x: (width - source.width * scale) / 2, y: (height - source.height * scale) / 2 };
      };
      fit();
      o.Global.setOutputSource(0, scene);
      {
        for (let i = 0; i < 20 && !(source.width > 0 && source.height > 0); i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (generation !== this.generation) throw new Error('共享已取消');
        }
        if (!(source.width > 0 && source.height > 0)) {
          throw new Error(config.sourceType === 'window'
            ? '无法读取窗口尺寸，请确保窗口未最小化，并重新选择共享源'
            : '无法读取显示器尺寸，请在房间设置中将整屏采集方式切换为 WGC 或自动后重试；远程桌面断开、锁屏也可能影响采集');
        }
        if (config.resolution === 'auto') {
          width = source.width; height = source.height;
          video.video = { ...videoSettings, baseWidth: width, baseHeight: height, outputWidth: width - width % 2, outputHeight: height - height % 2 };
        }
        fit();
      }
      // Keep the encoded canvas stable while fitting window resizes into it.
      if (config.sourceType === 'window') {
        let lastWidth = source.width, lastHeight = source.height;
        const timer = setInterval(() => {
          if (source.width > 0 && source.height > 0 && (source.width !== lastWidth || source.height !== lastHeight)) {
            lastWidth = source.width; lastHeight = source.height; fit();
          }
        }, 250);
        timer.unref?.(); this.own(timer, clearInterval);
      }
      if (config.shareAudio) {
        // Keep window audio isolated from desktop loopback. Never fall back to system audio.
        const isWindow = config.sourceType === 'window';
        const audio = this.own(o.InputFactory.create(isWindow ? 'wasapi_process_output_capture' : 'wasapi_output_capture', `audio-${Date.now()}`, isWindow ? { window: config.sourceId, priority: 0 } : { device_id: 'default' }), s => s.release());
        o.Global.setOutputSource(1, audio);
      }
      const bitrate = config.maxBitrate || Math.min(10000, Math.max(800, Math.round(width * height / (1280 * 720) * 1500 * config.frameRate / 30)));
      const encoder = config.videoEncoder || 'x264';
      const encoderId = { x264: 'obs_x264', nvenc: 'obs_nvenc_h264_tex', amf: 'h264_texture_amf' }[encoder];
      if (!encoderId) throw new Error('视频编码器选项无效');
      if (!o.VideoEncoderFactory.types().includes(encoderId)) throw new Error('当前电脑未提供所选编码器，请更新显卡驱动或切换到软件编码');
      const ve = this.own(o.VideoEncoderFactory.create(encoderId, `h264-${Date.now()}`, {
        bitrate, rate_control: 'CBR', keyint_sec: 2, bf: 0,
        ...(encoder === 'amf' ? { preset: 'balanced', profile: 'high' }
          : encoder === 'nvenc' ? { preset: 'p4', tune: 'll', multipass: 'disabled', profile: 'high', lookahead: false, adaptive_quantization: false }
          : { preset: 'veryfast', tune: 'zerolatency', profile: 'baseline' }),
      }), e => e.release());
      // The bundled factory can silently substitute x264 for unavailable hardware.
      if (ve.id !== encoderId) throw new Error('所选编码器未能加载，已阻止自动回退到其他编码器');
      // The streaming API requires an audio encoder even when the source is silent.
      const ae = this.own(o.AudioEncoderFactory.create('ffmpeg_opus', `opus-${Date.now()}`), e => e.release());
      ae.bitrate = config.audioBitrate;
      const service = this.own(o.ServiceFactory.create('whip_custom', `whip-${Date.now()}`, { server: this.publishUrl }), s => o.ServiceFactory.destroy(s));
      const stream = this.streaming = o.SimpleStreamingFactory.create();
      stream.service = service; stream.video = video; stream.videoEncoder = ve; stream.audioEncoder = ae;
      await new Promise((resolve, reject) => {
        let started = false;
        const timer = setTimeout(() => done(new Error('OBS 推流启动超时')), 15000);
        const done = error => { clearTimeout(timer); this.cancelStart = null; error ? reject(error) : resolve(); };
        this.cancelStart = () => done(new Error('OBS 推流已取消'));
        stream.signalHandler = signal => {
          console.log('[OBS]', signal);
          if (signal.signal === 'start') { started = true; done(); }
          if (signal.signal === 'stop') {
            const message = signal.error || `OBS 推流已停止 (${signal.code})`;
            if (!started) done(new Error(message));
            else if (!this.stopping) this.onFailure(message);
          }
        };
        try { stream.start(); } catch (error) { done(error); }
      });
      return { width, height, bitrate };
    } catch (error) {
      this.stop();
      if (['nvenc', 'amf'].includes(config.videoEncoder)) throw new Error(`${config.videoEncoder === 'amf' ? 'AMD AMF' : 'NVIDIA NVENC'} 硬件编码启动失败：${error.message}。请检查显卡驱动，或在房间设置中切回软件编码`);
      throw error;
    }
  }
  stop() {
    this.generation = (this.generation || 0) + 1;
    this.stopping = true;
    this.cancelStart?.();
    const o = this.osn;
    const attempt = fn => { try { fn(); } catch (e) { console.error('[OBS cleanup]', e.message); } };
    if (this.streaming) {
      const stream = this.streaming; this.streaming = null;
      attempt(() => stream.stop(true));
      attempt(() => o.SimpleStreamingFactory.destroy(stream));
    }
    if (this.initialized) for (const channel of [0, 1]) attempt(() => o.Global.setOutputSource(channel, null));
    while (this.resources.length) attempt(this.resources.pop());
    this.stopping = false;
    if (this.initialized) this.scheduleIdleShutdown();
  }
  shutdown() {
    this.stop();
    clearTimeout(this.idleTimer);
    if (this.hosted) {
      try { this.osn.NodeObs.OBS_service_removeCallback(); } catch {}
      try { this.osn.NodeObs.IPC.disconnect(); } catch {}
    }
    this.hosted = this.initialized = false;
  }
}
module.exports = { ObsEngine };

