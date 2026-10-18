// Isolated OBS host: microphone mixing must never enter the screen-share mix.
const { ObsEngine } = require('./obs-engine');
const options = JSON.parse(process.argv[3] || '{}');
const sourceType = options.sourceType || 'voice';
const engine = new ObsEngine(process.argv[2], message => { process.send?.({ error: message }); }, `http://127.0.0.1:${options.httpPort || 8890}/live/whip`, true);
let chain = Promise.resolve();
process.on('message', request => {
  chain = chain.then(async () => {
    try {
      let result;
      if (request.action === 'devices') {
        engine.init();
        const source = engine.osn.InputFactory.create('wasapi_input_capture', 'enumerate-microphones');
        try { result = source.properties.get('device_id').details.items.filter(i => i.enabled !== false).map(i => ({ id: i.value, name: i.name })); }
        finally { source.release(); engine.scheduleIdleShutdown(); }
      } else if (request.action === 'start') {
        if (sourceType === 'voice' && request.deviceId && request.deviceId !== 'default') {
          engine.init();
          const probe = engine.osn.InputFactory.create('wasapi_input_capture', 'check-microphone');
          try {
            const available = probe.properties.get('device_id').details.items.some(item => item.enabled !== false && item.value === request.deviceId);
            if (!available) throw new Error('所选麦克风当前不可用，请刷新设备并重新选择');
          } finally { probe.release(); }
        }
        await engine.start({ sourceType, sourceId: request.deviceId, microphoneId: request.deviceId, resolution: '16x16', frameRate: 15, maxBitrate: 100, audioBitrate: sourceType === 'voice' ? 64 : 128, videoEncoder: 'x264' });
        result = true;
      } else if (request.action === 'stop') { engine.shutdown(); result = true; }
      else throw new Error('无效语音请求');
      process.send?.({ id: request.id, result });
    } catch (error) { process.send?.({ id: request.id, error: error.message }); }
  });
});
process.on('disconnect', () => { engine.shutdown(); process.exit(0); });
