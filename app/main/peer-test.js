const path = require('path');
const { randomUUID } = require('crypto');
const { ManagedProcess } = require('./managed-process');

function createPeerTester(exe) {
  const probe = new ManagedProcess('节点测试');
  let busy = false;
  return {
    stop: () => probe.stop(),
    async test(value) {
      if (busy) throw new Error('正在测试节点，请稍候');
      const { normalizePeers } = await import('../renderer/easytier-peers.mjs');
      if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入一个节点地址');
      const peers = normalizePeers(value);
      if (peers.length !== 1) throw new Error('每次只能测试一个节点');
      if (busy) throw new Error('正在测试节点，请稍候');
      busy = true;
      const started = Date.now();
      try {
        // Ignore inherited EasyTier configuration; this probe must never create a TUN.
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('ET_')));
        await probe.start(exe, [
          '--no-tun', '--no-listener', '--disable-p2p', '--disable-upnp',
          '--network-name', `screensh-test-${randomUUID()}`, '--network-secret', randomUUID(),
          '--hostname', 'ScreenSh-node-test', '--rpc-portal', '127.0.0.1:0',
          '--console-log-level', 'info', '--stun-servers', '--stun-servers-v6', '-p', peers[0],
        ], {
          cwd: path.dirname(exe), env, timeout: 15000,
          // The connector emits this only after completing EasyTier peer negotiation.
          ready: log => /reconn result: Some\(Ok\(ReconnResult\s*\{/.test(log),
        });
        return { peer: peers[0], elapsedMs: Date.now() - started };
      } catch (error) {
        if (/ENOENT/.test(error.message)) throw new Error('缺少 EasyTier 程序，请检查软件文件是否完整');
        if (/超时/.test(error.message)) throw new Error('15 秒内未完成握手，请检查节点地址、协议、网络或节点访问限制');
        throw new Error('节点握手失败，请检查节点是否在线及是否允许公共接入');
      } finally {
        try { await probe.stop(); } finally { busy = false; }
      }
    },
  };
}
module.exports = { createPeerTester };
