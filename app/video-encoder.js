const ids = { x264: ['obs_x264'], nvenc: ['obs_nvenc_h264_tex'], amf: ['h264_texture_amf', 'h264_fallback_amf'], qsv: ['obs_qsv11_v2', 'obs_qsv11_soft_v2', 'obs_qsv11', 'obs_qsv11_soft'] };
function createVideoEncoder(factory, encoder, settings, name) {
  const candidates = ids[encoder];
  if (!candidates) throw new Error('视频编码器选项无效');
  const available = factory.types();
  if (!candidates.some(id => available.includes(id))) throw new Error('当前电脑未提供所选编码器，请更新显卡驱动或切换到软件编码');
  const errors = [];
  const requests = encoder === 'amf' ? ['amd', ...candidates] : encoder === 'qsv' ? ['qsv', ...candidates] : candidates;
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
module.exports = { createVideoEncoder };
