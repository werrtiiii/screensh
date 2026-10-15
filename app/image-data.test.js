const { test } = require('node:test');
const assert = require('node:assert/strict');
test('image limit counts decoded bytes and accepts a full 2 MiB file', async () => {
  const { isImageData, MAX_IMAGE_BYTES } = await import('./renderer/image-data.mjs');
  assert.equal(isImageData('data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES).toString('base64')), true);
  assert.equal(isImageData('data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')), false);
  assert.equal(isImageData('data:image/svg+xml;base64,AQID'), false);
  assert.equal(isImageData('data:image/png;base64,A'), false);
});
