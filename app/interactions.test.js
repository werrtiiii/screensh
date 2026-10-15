const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('all interaction icons, animations and sounds exist and agree with server allowlist', async () => {
  const { interactions } = await import('./renderer/interaction-catalog.mjs');
  assert.equal(interactions.length, 9);
  const server = fs.readFileSync(require.resolve('../server/server.js'), 'utf8');
  for (const item of interactions) {
    assert.ok(server.includes(`'${item.id}'`));
    for (const key of ['icon', 'animation', 'sound']) {
      const bytes = fs.readFileSync(new URL(item[key]));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), key === 'sound' ? 'WAVE' : 'WEBP');
      if (key === 'animation') assert.ok(bytes.includes(Buffer.from('ANIM')));
    }
    assert.ok(item.duration > 1000 && item.duration < 10000);
  }
});
