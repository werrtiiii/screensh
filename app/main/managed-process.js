const { spawn } = require('child_process');

// Own only the process we started. A failed or cancelled start must never report ready.
class ManagedProcess {
  constructor(name, onExit = () => {}) { this.name = name; this.onExit = onExit; this.child = null; }
  start(exe, args, { cwd, ready, probe, timeout = 15000, env = process.env } = {}) {
    if (this.child) return Promise.reject(new Error(`${this.name} 已在运行或启动中`));
    this.output = '';
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let settled = false, readySucceeded = false, tail = '';
      const clean = () => { clearTimeout(timer); clearInterval(poll); this.cancel = null; };
      const finish = error => {
        if (settled) return;
        settled = true; clean();
        if (error) { child.kill(); reject(error); } else { readySucceeded = true; resolve(); }
      };
      const timer = setTimeout(() => finish(new Error(`${this.name} 启动超时。${tail.slice(-400)}`)), timeout);
      const poll = probe ? setInterval(() => { try { if (probe()) finish(); } catch (e) { finish(e); } }, 200) : null;
      this.cancel = () => finish(new Error(`${this.name} 启动已取消`));
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
        const text = data.toString(); tail = (tail + text).slice(-2000);
        this.output = (this.output + text).slice(-16000);
        console.log(`[${this.name}] ${text.trim()}`);
        if (ready?.(tail)) finish();
      });
      child.once('error', error => finish(new Error(`${this.name}: ${error.message}`)));
      child.once('close', code => {
        const unexpected = this.child === child && !this.stopping;
        if (this.child === child) this.child = null;
        finish(new Error(`${this.name} 已退出 (${code})。${tail.slice(-400)}`));
        if (unexpected && readySucceeded) this.onExit(`${this.name} 已退出 (${code})`);
      });
    });
  }
  async waitForOutput(pattern, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (this.child && Date.now() < deadline) {
      if (pattern.test(this.output)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${this.name} 媒体流未就绪`);
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.cancel?.();
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${this.name} 未能退出`)), 5000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    } finally { this.stopping = false; }
  }
}
module.exports = { ManagedProcess };
