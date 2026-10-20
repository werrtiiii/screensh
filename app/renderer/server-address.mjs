export const DEFAULT_SERVER_PORT = 31012;

export function normalizeServerAddress(value) {
  if (typeof value !== 'string' || !value.trim() || /[\s\\]/.test(value.trim())) throw new Error('请输入有效的域名或 IP 地址');
  let source = value.trim();
  if (/^[0-9a-f:]+$/i.test(source) && (source.match(/:/g) || []).length > 1) source = `[${source}]`;
  if (!source.includes('://')) source = 'http://' + source.replace(/^\/\//, '');
  const url = new URL(source);
  const authority = source.slice(source.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  const suffix = source.slice(source.indexOf('://') + 3 + authority.length);
  if (!['http:', 'https:'].includes(url.protocol) || !authority || !url.hostname || url.username || url.password || (suffix && suffix !== '/') || authority.endsWith(':')) throw new Error('地址只能包含协议、域名或 IP 和端口');
  // Validate the raw port before URL normalizes standard ports away.
  const explicitPort = authority.match(/:(\d+)$/)?.[1];
  if (explicitPort !== undefined && (Number(explicitPort) < 1 || Number(explicitPort) > 65535)) throw new Error('服务器端口必须在1至65535之间');
  return url.origin;
}

export function serverAddressCandidates(value) {
  const first = normalizeServerAddress(value);
  const raw = value.trim().replace(/\/$/, '');
  const explicitPort = /:\d+$/.test(raw) && !(/^[0-9a-f:]+$/i.test(raw) && (raw.match(/:/g) || []).length > 1);
  if (explicitPort) return [first];
  const url = new URL(first), candidates = [first];
  // Bare domains may be HTTPS-only, or redirect HTTP requests to HTTPS.
  if (!raw.includes('://') && url.protocol === 'http:') candidates.push(`https://${url.host}`);
  url.port = String(DEFAULT_SERVER_PORT);
  candidates.push(url.origin);
  return [...new Set(candidates)];
}

export async function connectServerAddress(value, connect, timeout = 5000) {
  let lastError;
  for (const url of serverAddressCandidates(value)) {
    const connection = connect(url);
    try {
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer); connection.off('connect', ready); connection.off('connect_error', failed);
          error ? reject(error) : resolve();
        };
        const ready = () => finish(), failed = () => finish(new Error('无法连接到服务器，请检查服务器地址、网络连接及服务器是否已启动'));
        const timer = setTimeout(() => finish(new Error('连接服务器超时')), timeout);
        connection.once('connect', ready); connection.once('connect_error', failed);
        if (connection.connected) ready();
      });
      return { connection, url };
    } catch (error) { lastError = error; connection.removeAllListeners(); connection.disconnect(); }
  }
  throw lastError;
}
