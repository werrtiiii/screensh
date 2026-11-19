const test = require('node:test');
const assert = require('node:assert/strict');
test('video stats use interval deltas, selected transport RTT, and reset baselines', async () => {
  const { sampleVideoStats } = await import('../renderer/video-stats.mjs');
  const v = { id: 'video', type: 'inbound-rtp', kind: 'video', timestamp: 1000, bytesReceived: 10000, framesDecoded: 20, frameWidth: 1920, frameHeight: 1080, transportId: 't', packetsReceived: 100, packetsLost: 0, jitterBufferDelay: 1, jitterBufferEmittedCount: 20, totalDecodeTime: 0.04 };
  const report = video => new Map([['video', video], ['t', { selectedCandidatePairId: 'pair' }], ['pair', { currentRoundTripTime: 0.04 }]]);
  const first = sampleVideoStats(report(v));
  assert.equal(Object.fromEntries(first.rows)['视频接收码率'], '—');
  const next = { ...v, timestamp: 2000, bytesReceived: 210000, framesDecoded: 50, packetsReceived: 198, packetsLost: 2, jitterBufferDelay: 2.5, jitterBufferEmittedCount: 50, totalDecodeTime: 0.1 };
  const rows = Object.fromEntries(sampleVideoStats(report(next), first.snapshot).rows);
  assert.equal(rows['视频接收码率'], '1600 kbps');
  assert.equal(rows['解码帧率'], '30.0 FPS');
  assert.equal(rows['网络往返 RTT'], '40.0 ms');
  assert.equal(rows['接收缓冲耗时'], '50.0 ms');
  assert.equal(rows['平均解码耗时'], '2.0 ms');
  assert.equal(rows['区间丢包率'], '2.0 %');
  assert.equal(rows['接收缓冲与解码'], '52.0 ms');
  assert.equal(sampleVideoStats(report(next), first.snapshot).rows.find(r => r[0] === '区间丢包率')[2], true);
  const reset = Object.fromEntries(sampleVideoStats(report({ ...next, id: 'new' }), first.snapshot).rows);
  assert.equal(reset['视频接收码率'], '—');
  const stalled = Object.fromEntries(sampleVideoStats(report({ ...v, timestamp: 2000 }), first.snapshot).rows);
  assert.equal(stalled['解码帧率'], '0.0 FPS');
  assert.equal(stalled['视频接收码率'], '0 kbps');
  assert.equal(stalled['接收缓冲与解码'], '本秒无解码帧');
  assert.equal(stalled['接收缓冲耗时'], '本秒无输出帧');
  assert.equal(stalled['平均解码耗时'], '本秒无解码帧');
  const missing = report(next); missing.delete('pair');
  assert.equal(Object.fromEntries(sampleVideoStats(missing, first.snapshot).rows)['接收缓冲与解码'], '52.0 ms');
  const measured=report({...next,decoderImplementation:'D3D11VideoDecoder'});
  const diagnostics={hardwareDecodeAvailable:true,publisher:{encoder:'obs_nvenc_h264_tex',droppedFrames:0},udp:[{queueDelayMs:12,dropped:2}]};
  const diagnosticRows=Object.fromEntries(sampleVideoStats(measured,first.snapshot,diagnostics).rows);
  assert.equal(diagnosticRows['实际解码器'],'D3D11VideoDecoder');assert.equal(diagnosticRows['本机媒体排队'],'12.0 ms');assert.equal(diagnosticRows['本机媒体过载丢包'],'2 包');
  assert.deepEqual(sampleVideoStats(new Map()).rows, [['状态', '等待视频数据…']]);
});

test('video diagnostics distinguish minimum buffering, audio buffering, and audio-video timing', async () => {
  const { sampleVideoStats } = await import('../renderer/video-stats.mjs');
  const report = (time) => new Map([
    ['v', { id:'v', type:'inbound-rtp', kind:'video', timestamp:time, jitterBufferEmittedCount:60*time,
      jitterBufferMinimumDelay:1.2*time, jitterBufferTargetDelay:12*time, estimatedPlayoutTimestamp:time+40 }],
    ['a', { id:'a', type:'inbound-rtp', kind:'audio', timestamp:time, jitterBufferEmittedCount:48000*time,
      jitterBufferDelay:2400*time, estimatedPlayoutTimestamp:time+65 }],
  ]);
  const first = sampleVideoStats(report(1));
  const rows = Object.fromEntries(sampleVideoStats(report(2), first.snapshot).rows);
  assert.equal(rows['视频最低缓冲'], '20.0 ms');
  assert.equal(rows['接收目标缓冲'], '200.0 ms');
  assert.equal(rows['音频接收缓冲'], '50.0 ms');
  assert.equal(rows['音画播放时间差'], '25.0 ms');
});
