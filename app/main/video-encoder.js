const ids = {
  x264: ['obs_x264'],
  nvenc: ['obs_nvenc_h264_tex', 'jim_nvenc', 'ffmpeg_nvenc'],
  amf: ['h264_texture_amf', 'h264_fallback_amf'],
  qsv: ['obs_qsv11_v2', 'obs_qsv11_soft_v2', 'obs_qsv11', 'obs_qsv11_soft'],
  'nvenc-av1': ['obs_nvenc_av1_tex', 'obs_nvenc_av1_soft', 'ffmpeg_nvenc_av1'],
  'qsv-av1': ['obs_qsv11_av1', 'obs_qsv11_av1_soft'],
  'amf-av1': ['av1_texture_amf', 'av1_fallback_amf'],
};
const av1Aliases = { 'nvenc-av1': 'nvenc_av1', 'qsv-av1': 'qsv_av1', 'amf-av1': 'amd_av1' };
const isVideoEncoder = encoder => Object.hasOwn(ids, encoder);
function createVideoEncoder(factory, encoder, settings, name) {
  if (!isVideoEncoder(encoder)) throw new Error('视频编码器选项无效');
  const candidates = ids[encoder];
  const available = factory.types();
  const av1Alias = Object.hasOwn(av1Aliases, encoder) ? av1Aliases[encoder] : null;
  if (!candidates.some(id => available.includes(id))) {
    if (av1Alias) throw new Error('当前显卡或驱动未提供所选的 AV1 硬件编码器，请选择支持 AV1 的显卡或切回 H.264。');
    throw new Error('当前电脑未提供所选编码器。' + (encoder === 'nvenc' ? 'NVENC 需要 NVIDIA 显卡；仅有 AMD 核显请选择 AMD AMF。' : '请检查对应显卡驱动。') + '已注册视频编码器：' + available.join(', '));
  }
  const errors = [];
  const alias = av1Alias || ({ amf: 'amd', qsv: 'qsv', nvenc: 'nvenc' })[encoder];
  const requests = alias ? [alias, ...candidates] : candidates;
  for (const id of requests) {
    if (encoder === 'qsv' && id !== 'qsv' && !available.includes(id) && !id.includes('_soft')) continue;
    let value;
    try {
      // This bundled factory uses public aliases (amd/qsv); raw OBS IDs can
      // silently map to x264. Always verify the actual native encoder ID.
      // AMF's fallback encoder is internal and may be omitted from types().
      // It still uses AMD hardware, with CPU frame transfer instead of textures.
      value = factory.create(id, name + '-' + id, settings);
      if (!value || !candidates.includes(value.id)) throw new Error(`请求 ${id}，实际加载 ${value?.id || '空编码器'}`);
      console.log('[OBS encoder]', JSON.stringify({ requested: encoder, actual: value.id }));
      return value;
    } catch (error) {
      value?.release(); errors.push(error.message);
    }
  }
  throw new Error('所选硬件编码器未能加载：' + errors.join('；'));
}
module.exports = { createVideoEncoder, isVideoEncoder };
