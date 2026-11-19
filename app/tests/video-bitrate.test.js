const { test } = require('node:test');
const assert = require('node:assert/strict');

test('video bitrate scales with resolution and frame rate within the encoder limits', async () => {
  const { recommendedVideoBitrate } = await import('../renderer/video-bitrate.mjs');
  for (const [width, height, expected] of [
    [854, 480, [700, 1200, 1900]],
    [1280, 720, [1300, 2200, 3500]],
    [1920, 1080, [2100, 3500, 5600]],
    [2560, 1440, [3000, 5000, 8000]],
    [3840, 2160, [4500, 7500, 10000]],
  ]) assert.deepEqual([15, 30, 60].map(fps => recommendedVideoBitrate(width, height, fps)), expected);
  assert.equal(recommendedVideoBitrate(320, 180, 15), 500);
  assert.ok(recommendedVideoBitrate(1600, 900, 60) > 3500);
  assert.ok(recommendedVideoBitrate(1600, 900, 60) < 5600);
});
