const { test } = require('node:test');
const assert = require('node:assert/strict');

test('voice buffer preference uses milliseconds for the standard API and seconds for old Chromium', async () => {
  const { preferVoiceReceiveLatency } = await import('./renderer/voice-latency.mjs');
  const modern = { track: { kind: 'audio' }, jitterBufferTarget: null, playoutDelayHint: null };
  assert.equal(preferVoiceReceiveLatency(modern), 'jitterBufferTarget');
  assert.equal(modern.jitterBufferTarget, 0);
  assert.equal(modern.playoutDelayHint, null);
  const legacy = { track: { kind: 'audio' }, playoutDelayHint: null };
  assert.equal(preferVoiceReceiveLatency(legacy), 'playoutDelayHint');
  assert.equal(legacy.playoutDelayHint, 0);
  const rejected = { track: { kind: 'audio' }, set jitterBufferTarget(_) { throw Error('Unsupported'); }, playoutDelayHint: null };
  assert.equal(preferVoiceReceiveLatency(rejected), 'playoutDelayHint');
  assert.equal(rejected.playoutDelayHint, 0);
  const unsupported = { track: { kind: 'audio' } };
  assert.equal(preferVoiceReceiveLatency(unsupported), null);
  assert.equal('jitterBufferTarget' in unsupported, false);
  assert.equal(preferVoiceReceiveLatency(null), null);
  const video = { track: { kind: 'video' }, jitterBufferTarget: null };
  assert.equal(preferVoiceReceiveLatency(video), null);
  assert.equal(video.jitterBufferTarget, null);
});

test('10ms packet preference stays inside Opus audio sections and preserves FEC, stereo and other media', async () => {
  const { preferVoicePacketTime } = await import('./renderer/voice-latency.mjs');
  const session = 'v=0\r\na=group:BUNDLE 0 1 2\r\n';
  const video = 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\na=ptime:40\r\n';
  const data = 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n';
  const audio = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=1\r\na=ptime:20\r\n';
  const result = preferVoicePacketTime(session + audio + video + audio + data);
  assert.ok(result.startsWith(session));
  assert.ok(result.includes(video));
  assert.ok(result.endsWith(data));
  assert.equal((result.match(/a=ptime:10/g) || []).length, 2);
  assert.equal((result.match(/minptime=10;useinbandfec=1;stereo=1/g) || []).length, 2);
  assert.equal(preferVoicePacketTime(result), result);
  const lf = 'v=0\nm=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2';
  assert.equal(preferVoicePacketTime(lf), lf + '\na=ptime:10');
  const nonOpus = 'm=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\na=ptime:20\n';
  assert.equal(preferVoicePacketTime(nonOpus), nonOpus);
});
