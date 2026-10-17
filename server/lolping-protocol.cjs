function cleanLolPingEndpoint(raw) {
  if (!raw || !Number.isInteger(raw.port) || raw.port < 1024 || raw.port > 65535
    || typeof raw.publicKey !== 'string' || !/^[A-Za-z0-9+/]{59}=$/.test(raw.publicKey)) return null;
  const key = Buffer.from(raw.publicKey, 'base64');
  if (key.length !== 44 || key.toString('base64') !== raw.publicKey || key.subarray(0, 12).toString('hex') !== '302a300506032b656e032100') return null;
  return { port: raw.port, publicKey: raw.publicKey };
}
module.exports = { cleanLolPingEndpoint };
