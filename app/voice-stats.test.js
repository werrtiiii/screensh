const { test } = require('node:test');
const assert = require('node:assert/strict');
function report(audio = {}, pair = {}) {
  return new Map([
    ['audio', { type: 'inbound-rtp', id: 'audio', kind: 'audio', timestamp: 1000, transportId: 'transport', codecId: 'codec', packetsReceived: 100, packetsLost: 0, jitterBufferDelay: 10, jitterBufferEmittedCount: 1000, bytesReceived: 1000, ...audio }],
    ['transport', { selectedCandidatePairId: 'selected' }],
    ['selected', { currentRoundTripTime: 0.06, localCandidateId: 'local', ...pair }],
    ['other', { type: 'candidate-pair', currentRoundTripTime: 9 }],
    ['local', { protocol: 'udp', candidateType: 'host' }], ['codec', { mimeType: 'audio/opus' }],
  ]);
}
test('voice statistics use selected-pair RTT and interval loss, jitter buffer and bitrate', async () => {
  const { sampleVoiceStats } = await import('./renderer/voice-stats.mjs');
  const first = sampleVoiceStats(report());
  assert.equal(first.loss, null); assert.equal(first.buffer, null); assert.equal(first.rtt, 60);
  const next = sampleVoiceStats(report({ timestamp: 2000, packetsReceived: 148, packetsLost: 2, jitterBufferDelay: 11, jitterBufferEmittedCount: 1020, bytesReceived: 5000, jitter: 0.012 }), first.snapshot);
  assert.equal(next.loss, 4); assert.equal(next.buffer, 50); assert.equal(next.kbps, 32); assert.equal(next.jitter, 12); assert.equal(next.codec, 'audio/opus');
});
test('voice statistics do not invent zero latency/loss for missing or reset counters', async () => {
  const { sampleVoiceStats } = await import('./renderer/voice-stats.mjs');
  const first = sampleVoiceStats(report());
  for (const audio of [{ id: 'new', timestamp: 2000 }, { timestamp: 500 }, { timestamp: 2000, packetsReceived: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0 }]) {
    const value = sampleVoiceStats(report(audio), first.snapshot); assert.equal(value.loss, null); assert.equal(value.buffer, null);
  }
  assert.equal(sampleVoiceStats(new Map()).rtt, null);
  assert.equal(sampleVoiceStats(report({}, { currentRoundTripTime: undefined })).rtt, null);
  assert.equal(sampleVoiceStats(report({ timestamp: 2000 }), first.snapshot).buffer, null);
});
