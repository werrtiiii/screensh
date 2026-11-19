function videoEncoderSettings(encoder, bitrate, frameRate) {
  const common = { bitrate, rate_control: 'CBR', keyint_sec: 1, bf: 0, repeat_headers: true };
  if (encoder === 'nvenc-av1') return { ...common, preset: 'p4', tune: 'ull', multipass: 'disabled', profile: 'main', lookahead: false, adaptive_quantization: false };
  if (encoder === 'qsv-av1') return { ...common, target_usage: 'TU4', latency: 'ultra-low', bframes: 0 };
  if (encoder === 'amf-av1') return { ...common, preset: 'speed', profile: 'main', pre_analysis: false };
  if (encoder === 'nvenc') return { ...common, preset: 'p4', tune: 'ull', multipass: 'disabled', profile: 'high', lookahead: false, adaptive_quantization: false };
  if (encoder === 'qsv') return { ...common, target_usage: 'TU4', latency: 'ultra-low', profile: 'high', bframes: 0 };
  if (encoder === 'amf') return {
    ...common, preset: 'speed', profile: 'high',
    // OBS's simple output overrides the AMF preset and keyframe interval.
    // The AMF plugin applies its native options after those defaults.
    ffmpeg_opts: ['QualityPreset=1', ...(frameRate ? [`IDRPeriod=${frameRate}`, `HeaderInsertionSpacing=${frameRate}`] : [])].join(' '),
  };
  // zerolatency enables sliced threads. Multiple slices break continuous H.264
  // decoding on our WHIP/WHEP path. A single frame/thread also avoids the frame
  // queue introduced by switching back to automatic frame threading.
  return { ...common, preset: 'veryfast', tune: 'zerolatency', profile: 'baseline', x264opts: 'sliced-threads=0 threads=1' };
}
module.exports = { videoEncoderSettings };
