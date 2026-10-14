const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('installer excludes stock MediaMTX config and copies the application config separately', () => {
  const resources = require('./package.json').build.extraResources;
  assert.ok(resources.find(item => item.from === 'res').filter.includes('!mediamtx.yml'));
  assert.ok(resources.some(item => item.from === 'mediamtx.yml' && item.to === 'mediamtx.yml'));
  for (const protocol of ['rtsp', 'rtmp', 'hls', 'srt']) assert.match(fs.readFileSync(require.resolve('./mediamtx.yml'), 'utf8'), new RegExp('^' + protocol + ': false\\r?$', 'm'));
});
test('screen and voice runtimes disable unused listener protocols independently of config file', () => {
  for (const file of ['./main.js', './voice-runtime.cjs']) {
    const code = fs.readFileSync(require.resolve(file), 'utf8');
    for (const protocol of ['RTSP', 'RTMP', 'HLS', 'SRT']) assert.ok(code.includes(`MTX_${protocol}: 'false'`));
  }
});
