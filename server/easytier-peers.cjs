const DEFAULT_PEER = 'hhh.591.world:11010\n6.rn1.me:11010\nfrp-run.com:11012';

function normalizePeers(value) {
  const entries = typeof value === 'string' ? value.split(/\r?\n/) : value;
  if (!Array.isArray(entries) || entries.length > 32) throw new Error('EasyTier 节点最多填写 32 个');
  const peers = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error('EasyTier 节点格式无效');
    const text = entry.trim();
    if (!text) continue;
    const match = text.match(/^(?:(tcp|udp):\/\/)?([^/?#]+)\/?$/i);
    let url;
    // Parse the authority with a standard scheme: Chromium and Node differ for tcp URLs.
    try { if (match) url = new URL(`http://${match[2]}`); } catch {}
    const port = match?.[2].match(/:(\d+)$/)?.[1];
    if (!url || !url.hostname || !port
      || Number(port) < 1 || Number(port) > 65535 || url.username || url.password
      || (url.pathname && url.pathname !== '/') || url.search || url.hash || /\s/.test(text)) {
      throw new Error(`节点地址无效：${text}，请填写 主机:端口 或 tcp://主机:端口、udp://主机:端口`);
    }
    peers.push(`${(match[1] || 'tcp').toLowerCase()}://${url.hostname}:${Number(port)}`);
  }
  if (!peers.length) throw new Error('请至少填写一个 EasyTier 节点');
  return [...new Set(peers)];
}

module.exports = { DEFAULT_PEER, normalizePeers };
