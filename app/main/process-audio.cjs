const { spawn, execFile } = require('child_process');
class ProcessAudio {
  constructor(exe, onData, onFailure) { Object.assign(this, { exe, onData, onFailure }); this.queue = Promise.resolve(); this.nextSession = 0; }
  serial(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  list() {
    return new Promise((resolve, reject) => execFile(this.exe, ['--list'], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error('无法读取程序音源：' + (stderr.trim() || error.message)));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('程序音源列表无效')); }
    }));
  }
  start(pid) {
    return this.serial(async () => {
      await this.cleanup();
      const session = ++this.nextSession;
      const child = this.child = spawn(this.exe, ['--capture', String(pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let ready = false, errorText = '', remainder = Buffer.alloc(0);
      const started = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('后台程序音频采集启动超时')), 12000);
        child.stderr.on('data', chunk => {
          errorText = (errorText + chunk.toString()).slice(-4096);
          if (!ready && /(?:^|\n)READY\r?\n/.test(errorText)) { ready = true; clearTimeout(timer); resolve(); }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); if (!ready) reject(new Error('无法采集所选程序声音：' + errorText.trim())); });
      });
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        const bytes = Buffer.concat([remainder, chunk]), aligned = bytes.length - bytes.length % 4;
        remainder = Buffer.from(bytes.subarray(aligned));
        if (aligned) this.onData({ session, data: Uint8Array.from(bytes.subarray(0, aligned)) });
      });
      child.once('exit', () => { if (this.child === child && ready) { this.child = null; this.onFailure('伴奏音源已停止：' + errorText.replace(/READY\s*/, '').trim()); } });
      try { await started; return { kind: 'pcm', session }; }
      catch (error) { await this.cleanup(); throw error; }
    });
  }
  async cleanup() {
    const child = this.child; this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('后台程序音频采集未能停止')), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  }
  stop() { return this.serial(() => this.cleanup()); }
}
module.exports = { ProcessAudio };
