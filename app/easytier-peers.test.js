const test = require('node:test');
const assert = require('node:assert/strict');

test('EasyTier peers normalize multiple lines and remove duplicates', async () => {
  const { normalizePeers, DEFAULT_PEER } = await import('./renderer/easytier-peers.mjs');
  assert.deepEqual(normalizePeers(DEFAULT_PEER), ['tcp://hhh.591.world:11010', 'tcp://6.rn1.me:11010', 'tcp://frp-run.com:11012']);
  assert.deepEqual(normalizePeers(' example.com:11010\r\nudp://192.168.1.2:11010\n\ntcp://example.com:11010 '),
    ['tcp://example.com:11010', 'udp://192.168.1.2:11010']);
  assert.deepEqual(normalizePeers(['[::1]:11010']), ['tcp://[::1]:11010']);
});

test('EasyTier peers reject empty, malformed and non-peer addresses', async () => {
  const { normalizePeers } = await import('./renderer/easytier-peers.mjs');
  for (const value of ['', 'host', 'host:0', 'host:65536', 'http://host:80', 'tcp://user:pass@host:10',
    'host:10/path', 'host:10?x=1', '--help', [null], Array(33).fill('host:10')]) {
    assert.throws(() => normalizePeers(value));
  }
});
