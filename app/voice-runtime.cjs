const { fork } = require('child_process');
const path = require('path');
const { ManagedProcess } = require('./managed-process');
class VoiceRuntime {
  constructor(dataPath, exe, config, onFailure, options = {}) {
    Object.assign(this, { dataPath, exe, config, onFailure });
    this.options = { httpPort: 8890, icePort: 8190, sourceType: 'voice', ...options };
    this.pending = new Map(); this.nextId = 0; this.queue = Promise.resolve();
    this.media = new ManagedProcess('Voice MediaMTX', onFailure);
  }
  request(action, deviceId) {
    if (!this.worker) {
      const worker = this.worker = fork(path.join(__dirname, 'voice-worker.cjs'), [this.dataPath, JSON.stringify(this.options)], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      worker.stdout.on('data', d => { if (process.env.SCREENSH_VOICE_DEBUG === '1') console.log('[Voice OBS]', d.toString()); }); worker.stderr.on('data', d => console.error('[Voice OBS]', d.toString()));
      worker.on('message', msg => {
        const pending = this.pending.get(msg.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(msg.id); msg.error ? pending.reject(new Error(msg.error)) : pending.resolve(msg.result); }
        else if (msg.error) this.onFailure(msg.error);
      });
      const fail = error => {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear();
        if (this.active) this.onFailure(error.message);
      };
      worker.on('error', fail); worker.on('exit', () => fail(new Error('OBS 麦克风进程已退出')));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('OBS 麦克风操作超时')); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.send({ id, action, deviceId });
    });
  }
  serial(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  devices() { return this.serial(() => this.request('devices')); }
  start(deviceId) {
    return this.serial(async () => {
      if (this.active) throw new Error('麦克风已在使用');
      try {
        await this.media.start(this.exe, [this.config], { ready: log => /\[WebRTC\] listener opened/.test(log), env: { ...process.env, MTX_WEBRTCADDRESS: `127.0.0.1:${this.options.httpPort}`, MTX_WEBRTCLOCALUDPADDRESS: `127.0.0.1:${this.options.icePort}`, MTX_WEBRTCLOCALTCPADDRESS: `127.0.0.1:${this.options.icePort}`, MTX_WEBRTCIPSFROMINTERFACES: 'false', MTX_WEBRTCADDITIONALHOSTS: '127.0.0.1' } });
        await this.request('start', deviceId);
        await this.media.waitForOutput(/\[path live\] stream is available/);
        this.active = true;
        return `http://127.0.0.1:${this.options.httpPort}/live/whep`;
      } catch (error) { await this.cleanup(); throw error; }
    });
  }
  async cleanup() {
    try { if (this.worker) await this.request('stop'); }
    finally { this.worker?.disconnect(); this.worker = null; this.active = false; await this.media.stop(); }
  }
  stop() { return this.serial(() => this.cleanup()); }
}
module.exports = { VoiceRuntime };
