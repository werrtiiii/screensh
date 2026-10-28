// Opt-in GPU check: generates a color and silent audio, publishes only to loopback.
const path = require('node:path');
const assert = require('node:assert/strict');
const { ObsEngine } = require('../../main/obs-engine');
const { ManagedProcess } = require('../../main/managed-process');
const root = path.resolve(__dirname, '../..');
const temporary = path.join(root, '.runtime-probe', 'isolated-hardware-' + process.pid);
const encoder = process.env.SCREENSH_TEST_HARDWARE || 'nvenc';
class SyntheticEngine extends ObsEngine {
  createSource() { return this.osn.InputFactory.create('color_source_v3', 'hardware-color-' + process.pid, {width:640,height:360,color:0xffff6600}); }
}
const media = new ManagedProcess('hardware-loopback');
const obs = new SyntheticEngine(temporary, message => console.error('HARDWARE_OUTPUT_FAILURE',message), 'http://127.0.0.1:18889/live/whip', true);
(async()=>{
  try {
    obs.init();
    console.log('ISOLATED_ENCODERS', JSON.stringify(obs.osn.VideoEncoderFactory.types()));
    await media.start(path.join(root,'res/mediamtx.exe'),[path.join(root,'mediamtx.yml')],{
      cwd:temporary,ready:log=>/\[WebRTC\] listener opened/.test(log),
      env:{...process.env,MTX_RTSP:'false',MTX_RTMP:'false',MTX_HLS:'false',MTX_SRT:'false',MTX_API:'false',MTX_METRICS:'false',MTX_PPROF:'false',MTX_PLAYBACK:'false',MTX_WEBRTCADDRESS:'127.0.0.1:18889',MTX_WEBRTCLOCALUDPADDRESS:'127.0.0.1:18189',MTX_WEBRTCLOCALTCPADDRESS:'127.0.0.1:18189',MTX_WEBRTCIPSFROMINTERFACES:'false',MTX_WEBRTCADDITIONALHOSTS:'127.0.0.1'},
    });
    await obs.start({sourceType:'synthetic',resolution:'640x360',frameRate:30,maxBitrate:1000,audioBitrate:96,videoEncoder:encoder,shareAudio:false});
    await new Promise(resolve=>setTimeout(resolve,1500));
    assert.ok(obs.streaming);
    console.log('ISOLATED_HARDWARE_STREAM_OK',encoder);
  } finally {obs.shutdown();await media.stop();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
