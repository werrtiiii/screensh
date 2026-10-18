const {test}=require('node:test');
const assert=require('node:assert/strict');
test('Opus stereo negotiation preserves other codecs, FEC and CRLF and is idempotent',async()=>{
  const {allowOpusStereo,channelVoiceBitrate}=await import('../renderer/voice-encoding.mjs');
  const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=32000\r\na=rtpmap:0 PCMU/8000\r\n';
  const result=allowOpusStereo(sdp);
  assert.ok(result.includes('minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=96000\r\n'));
  assert.ok(result.endsWith('a=rtpmap:0 PCMU/8000\r\n'));
  assert.equal(allowOpusStereo(result),result);
  assert.equal(channelVoiceBitrate([{id:'main',voiceBitrate:64}],'main'),64);
  assert.equal(channelVoiceBitrate([{id:'main',voiceBitrate:48}],'main'),32);
});
