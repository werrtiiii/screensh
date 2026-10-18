const { execFile } = require('node:child_process');
const { isIPv4 } = require('node:net');
const path = require('node:path');

function createMemberPinger({ execute = execFile, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0;
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE');
  function drain() {
    while (active < 6 && queue.length) {
      const { ip, resolve } = queue.shift(); active++;
      execute(exe, ['-4', '-n', '1', '-w', '1000', ip], { windowsHide: true, timeout: 2000, maxBuffer: 16384 }, (error, stdout = '') => {
        // Time units and comparison signs survive both English and Chinese output.
        const match = String(stdout).match(/([=<])\s*(\d+)\s*ms/i);
        const result = { ip, rttMs: !error && match ? (match[1] === '<' ? 0.5 : Number(match[2])) : null };
        cache.set(ip, { result, expires: now() + 2500 });
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        pending.delete(ip); active--; resolve(result); drain();
      });
    }
  }
  return {
    ping(ip) {
      if (typeof ip !== 'string' || !isIPv4(ip) || !ip.startsWith('10.144.')) return Promise.reject(new Error('无效的成员虚拟 IP'));
      const cached = cache.get(ip); if (cached && cached.expires > now()) return Promise.resolve(cached.result);
      if (pending.has(ip)) return pending.get(ip);
      if (queue.length >= 100) return Promise.reject(new Error('网络检测繁忙，请稍后重试'));
      const promise = new Promise(resolve => { queue.push({ ip, resolve }); });
      pending.set(ip, promise); drain(); return promise;
    },
  };
}
module.exports = { createMemberPinger };
