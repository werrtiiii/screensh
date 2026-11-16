const {test}=require('node:test'),assert=require('node:assert/strict');
test('video receive latency configures both synchronized tracks and falls back on Electron 29',async()=>{
  const {preferVideoReceiveLatency}=await import('../renderer/video-latency.mjs');
  for(const kind of ['audio','video']){
    const modern={track:{kind},jitterBufferTarget:null,playoutDelayHint:null};
    assert.equal(preferVideoReceiveLatency(modern),'jitterBufferTarget');assert.equal(modern.jitterBufferTarget,0);assert.equal(modern.playoutDelayHint,null);
    const legacy={track:{kind},playoutDelayHint:null};assert.equal(preferVideoReceiveLatency(legacy),'playoutDelayHint');assert.equal(legacy.playoutDelayHint,0);
  }
  const fallback={track:{kind:'video'},set jitterBufferTarget(_){throw Error('unsupported');},playoutDelayHint:null};
  assert.equal(preferVideoReceiveLatency(fallback),'playoutDelayHint');assert.equal(preferVideoReceiveLatency({track:{kind:'video'}}),null);
});

test('software H264 cannot enable multi-slice or frame queues; hardware retains its explicit vendor settings',()=>{
  const {videoEncoderSettings}=require('../main/video-encoding.cjs');
  const software=videoEncoderSettings('x264',3000);
  assert.match(software.x264opts,/sliced-threads=0/);assert.match(software.x264opts,/threads=1/);assert.equal(software.tune,'zerolatency');
  for(const vendor of ['x264','nvenc','amf','qsv']){const value=videoEncoderSettings(vendor,3000);assert.equal(value.bitrate,3000);assert.equal(value.bf,0);assert.equal(value.repeat_headers,true);assert.equal(value.keyint_sec,1);}
  const nvenc=videoEncoderSettings('nvenc',4000);assert.equal(nvenc.tune,'ull');assert.equal(nvenc.lookahead,false);assert.equal(nvenc.multipass,'disabled');
});
