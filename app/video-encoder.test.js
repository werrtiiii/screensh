const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVideoEncoder } = require('./video-encoder');
test('bundled native factory receives AMD/QSV aliases and verifies returned OBS IDs', () => {
  for (const [choice, alias, actual] of [['amf', 'amd', 'h264_texture_amf'], ['qsv', 'qsv', 'obs_qsv11_v2']]) {
    const calls = [];
    const result = createVideoEncoder({ types: () => [actual], create: id => {
      calls.push(id); return { id: id === alias ? actual : 'obs_x264', release() {} };
    } }, choice, {}, 'test');
    assert.equal(result.id, actual); assert.deepEqual(calls, [alias]);
  }
});
test('QSV accepts hardware encoding with system-memory frame transfer', () => {
  const value = { id: 'obs_qsv11_soft_v2', release() {} };
  assert.equal(createVideoEncoder({ types: () => ['obs_qsv11_v2'], create: () => value }, 'qsv', {}, 'test'), value);
});
test('QSV supports older H264 plugin and refuses software substitution', () => {
  const calls = [];
  assert.equal(createVideoEncoder({ types: () => ['obs_qsv11'], create: id => {
    calls.push(id); if (id !== 'obs_qsv11') throw Error('Unavailable'); return { id, release() {} };
  } }, 'qsv', {}, 'test').id, 'obs_qsv11');
  assert.ok(calls.includes('obs_qsv11'));
  assert.throws(() => createVideoEncoder({ types: () => ['obs_qsv11_v2'], create: () => ({ id: 'obs_x264', release() {} }) }, 'qsv', {}, 'test'), /实际加载 obs_x264/);
});
test('AMF accepts OBS hardware frame-transfer reroute', () => {
  const value = { id: 'h264_fallback_amf', release() { throw Error('Must retain valid encoder'); } };
  assert.equal(createVideoEncoder({ types: () => ['h264_texture_amf'], create: () => value }, 'amf', {}, 'test'), value);
});
test('AMF retries internal hardware path and releases substituted software encoder', () => {
  let released = 0; const requested = [];
  const factory = { types: () => ['h264_texture_amf'], create: id => {
    requested.push(id); return { id: requested.length === 1 ? 'obs_x264' : 'h264_fallback_amf', release() { released++; } };
  } };
  assert.equal(createVideoEncoder(factory, 'amf', {}, 'test').id, 'h264_fallback_amf');
  assert.deepEqual(requested, ['amd', 'h264_texture_amf']); assert.equal(released, 1);
});
test('failed AMD paths never silently return software or another vendor', () => {
  let released = 0;
  assert.throws(() => createVideoEncoder({ types: () => ['h264_texture_amf'], create: () => ({ id: 'obs_x264', release() { released++; } }) }, 'amf', {}, 'test'), /实际加载 obs_x264/);
  assert.equal(released, 3);
});
