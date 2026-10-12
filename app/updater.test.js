const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, normalizeRepository } = require('./updater');

test('normalizes GitHub repository URLs and rejects unsafe values', () => {
  assert.equal(normalizeRepository('https://github.com/example/screensh.git'), 'example/screensh');
  assert.equal(normalizeRepository('example/screensh/extra'), '');
  assert.equal(normalizeRepository('javascript:alert(1)'), '');
});

test('compares release versions while accepting v-prefixed tags', () => {
  assert.equal(compareVersions('v1.5.0', '1.4.9'), 1);
  assert.equal(compareVersions('1.4.0', 'v1.4.0'), 0);
  assert.equal(compareVersions('1.3.9', '1.4.0'), -1);
});
