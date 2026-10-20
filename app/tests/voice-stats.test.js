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
  const { sampleVoiceStats } = await import('../renderer/voice-stats.mjs');
  const first = sampleVoiceStats(report());
  assert.equal(first.loss, null); assert.equal(first.buffer, null); assert.equal(first.rtt, 60);
  const next = sampleVoiceStats(report({ timestamp: 2000, packetsReceived: 148, packetsLost: 2, jitterBufferDelay: 11, jitterBufferEmittedCount: 1020, bytesReceived: 5000, jitter: 0.012 }), first.snapshot);
  assert.equal(next.loss, 4); assert.equal(next.buffer, 50); assert.equal(next.kbps, 32); assert.equal(next.jitter, 12); assert.equal(next.codec, 'audio/opus');
});
test('voice statistics do not invent zero latency/loss for missing or reset counters', async () => {
  const { sampleVoiceStats } = await import('../renderer/voice-stats.mjs');
  const first = sampleVoiceStats(report());
  for (const audio of [{ id: 'new', timestamp: 2000 }, { timestamp: 500 }, { timestamp: 2000, packetsReceived: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0 }]) {
    const value = sampleVoiceStats(report(audio), first.snapshot); assert.equal(value.loss, null); assert.equal(value.buffer, null);
  }
  assert.equal(sampleVoiceStats(new Map()).rtt, null);
  assert.equal(sampleVoiceStats(report({}, { currentRoundTripTime: undefined })).rtt, null);
  assert.equal(sampleVoiceStats(report({ timestamp: 2000 }), first.snapshot).buffer, null);
});

function detailedReport(timestamp, multiplier = 1) {
  const value = report({ timestamp, jitterBufferTargetDelay: 20 * multiplier, jitterBufferMinimumDelay: 10 * multiplier,
    jitterBufferEmittedCount: 1000 * multiplier, totalSamplesReceived: 48000 * multiplier,
    concealedSamples: 480 * multiplier, concealmentEvents: 2 * multiplier, packetsDiscarded: 3 * multiplier,
    packetsReceived: 100 * multiplier, bytesReceived: 4000 * multiplier });
  value.set('outbound', { type: 'outbound-rtp', kind: 'audio', id: 'outbound', timestamp,
    transportId: 'transport', codecId: 'codec', mediaSourceId: 'source', packetsSent: 100 * multiplier,
    bytesSent: 4000 * multiplier, totalPacketSendDelay: 0.2 * multiplier });
  value.set('source', { echoReturnLoss: 12, echoReturnLossEnhancement: 25 });
  value.set('codec', { mimeType: 'audio/opus', clockRate: 48000, channels: 2 });
  return value;
}
test('detailed voice metrics use independent send/receive intervals and correct units', async () => {
  const { sampleVoiceStats } = await import('../renderer/voice-stats.mjs');
  const first = sampleVoiceStats(detailedReport(1000));
  assert.equal(first.sendQueue, null); assert.equal(first.concealment, null);
  const next = sampleVoiceStats(detailedReport(3000, 2), first.snapshot, first.outboundSnapshot);
  assert.equal(next.sendQueue, 2);
  assert.equal(next.sendKbps, 16); assert.equal(next.kbps, 16);
  assert.equal(next.sendPacketsPerSecond, 50); assert.equal(next.receivePacketsPerSecond, 50);
  assert.equal(next.bufferTarget, 20); assert.equal(next.bufferMinimum, 10);
  assert.equal(next.concealment, 1); assert.equal(next.concealmentEvents, 2); assert.equal(next.discarded, 3);
  assert.equal(next.echoReturnLoss, 12); assert.equal(next.echoReturnLossEnhancement, 25);
  assert.equal(next.codecSampleRate, 48000); assert.equal(next.codecChannels, 2);
});
test('missing, reset and stationary detailed counters remain unavailable instead of reporting zero', async () => {
  const { sampleVoiceStats } = await import('../renderer/voice-stats.mjs');
  const first = sampleVoiceStats(detailedReport(1000));
  for (const current of [detailedReport(1000, 2), detailedReport(2000, 0), report({ timestamp: 2000 })]) {
    const next = sampleVoiceStats(current, first.snapshot, first.outboundSnapshot);
    for (const key of ['sendQueue', 'sendKbps', 'bufferTarget', 'bufferMinimum', 'concealment', 'concealmentEvents', 'discarded']) assert.equal(next[key], null, key);
  }
  const reset = detailedReport(2000, 2); reset.get('outbound').id = 'replacement';
  const next = sampleVoiceStats(reset, first.snapshot, first.outboundSnapshot);
  assert.equal(next.sendKbps, null); assert.equal(next.sendQueue, null);
  assert.equal(next.concealment, 1);
  const empty = sampleVoiceStats(new Map());
  for (const key of ['echoReturnLoss', 'echoReturnLossEnhancement', 'codecChannels', 'codecSampleRate']) assert.equal(empty[key], null);
});
test('send-only connections retain statistics without an inbound track', async () => {
  const { sampleVoiceStats } = await import('../renderer/voice-stats.mjs');
  const before = detailedReport(1000); before.delete('audio');
  const after = detailedReport(2000, 2); after.delete('audio');
  const first = sampleVoiceStats(before);
  const next = sampleVoiceStats(after, first.snapshot, first.outboundSnapshot);
  assert.equal(next.snapshot, null); assert.equal(next.sendKbps, 32);
  assert.equal(next.rtt, 60); assert.equal(next.codec, 'audio/opus');
  assert.equal(next.buffer, null); assert.equal(next.loss, null);
});

test('diagnostics render processing settings and refresh both directions only while expanded', async t => {
  const { attachVoiceStats } = await import('../renderer/voice-stats.mjs');
  class Element {
    constructor() { this.children = []; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
  }
  const panel = new Element();
  let toggle, tick, disconnected = false, calls = 0;
  const details = { open: true, querySelector: () => panel, closest: () => null,
    addEventListener: (_, fn) => { toggle = fn; }, removeEventListener: () => {} };
  const pc = { connectionState: 'connected', getStats: async () => detailedReport(++calls * 1000, calls) };
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 123; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const oldDocument = globalThis.document, oldObserver = globalThis.MutationObserver;
  globalThis.document = { createElement: () => new Element() };
  globalThis.MutationObserver = class { disconnect() { disconnected = true; } };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = oldObserver;
  });
  const dispose = attachVoiceStats(details, {
    getPeers: () => [{ pc, name: 'Member' }],
    getCapture: () => ({ enabled: true, mixed: true, track: { getSettings: () => ({ noiseSuppression: true, echoCancellation: false, latency: 0.01 }) } }),
  });
  t.after(dispose);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const rows = () => {
    const result = new Map();
    const walk = node => { if (node.className === 'voice-diagnostics-row') result.set(node.children[0].textContent, node.children[1].textContent); node.children.forEach(walk); };
    walk(panel); return result;
  };
  toggle(); await flush();
  assert.equal(rows().get('降噪（设备报告）'), '已开启');
  assert.equal(rows().get('回声消除（设备报告）'), '已关闭');
  assert.equal(rows().get('自动增益（设备报告）'), '设备未报告');
  assert.equal(rows().get('音频接收码率'), '—');
  assert.equal(rows().get('设备报告采集延迟'), '10.0 ms');
  tick(); await flush();
  assert.equal(rows().get('音频接收码率'), '32.0 kbps');
  assert.equal(rows().get('接收缓冲延迟（区间）'), '0.0 ms');
  details.open = false; toggle(); tick(); await flush();
  assert.equal(calls, 2);
  details.open = true; toggle(); await flush();
  assert.equal(rows().get('音频接收码率'), '—');
  dispose(); tick(); await flush();
  assert.equal(calls, 3); assert.equal(disconnected, true);
});
