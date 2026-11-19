const finite = value => Number.isFinite(value);
function counterDelta(current, previous, key) {
  return current && previous?.id === current.id && current.timestamp > previous.timestamp &&
    finite(current[key]) && finite(previous[key]) && current[key] >= previous[key]
    ? current[key] - previous[key] : null;
}
function meanBufferMs(current, previous, key) {
  const duration = counterDelta(current, previous, key);
  const count = counterDelta(current, previous, 'jitterBufferEmittedCount');
  return duration !== null && count > 0 ? 1000 * duration / count : null;
}
export function sampleVideoStats(report, previous, diagnostics) {
  const entries = [...report.values()];
  const video = entries.find(s => s.type === 'inbound-rtp' && s.kind === 'video');
  if (!video) return { snapshot: null, rows: [['状态', '等待视频数据…']] };
  const audio = entries.find(s => s.type === 'inbound-rtp' && s.kind === 'audio');
  const same = previous?.id === video.id && video.timestamp > previous.timestamp;
  const delta = key => counterDelta(video, previous, key);
  const elapsed = same ? (video.timestamp - previous.timestamp) / 1000 : null;
  const perSecond = key => delta(key) === null ? null : delta(key) / elapsed;
  const meanMs = (total, count) => delta(total) !== null && delta(count) > 0 ? 1000 * delta(total) / delta(count) : null;
  const format = (value, unit, digits = 1) => finite(value) ? `${value.toFixed(digits)} ${unit}` : '—';
  const transport = report.get(video.transportId);
  const pair = report.get(transport?.selectedCandidatePairId);
  const codec = report.get(video.codecId)||entries.find(row=>row.type==='codec'&&video.payloadType!==undefined&&row.payloadType===video.payloadType);
  const received = delta('packetsReceived'), lost = delta('packetsLost');
  const fps = perSecond('framesDecoded');
  const kbps = perSecond('bytesReceived') === null ? null : perSecond('bytesReceived') * 8 / 1000;
  const rtt = finite(pair?.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null;
  const buffer = meanMs('jitterBufferDelay', 'jitterBufferEmittedCount');
  const decode = meanMs('totalDecodeTime', 'framesDecoded');
  const jitter = finite(video.jitter) ? video.jitter * 1000 : null;
  const loss = received !== null && lost !== null && received + lost > 0 ? lost / (received + lost) * 100 : null;
  const stalled = fps === 0;
  // Capture, encoding and display scanout are not measured by inbound WebRTC
  // stats. Report the measured receiving stages instead of inventing a total.
  const receiving = !stalled && [buffer, decode].every(finite) ? buffer + decode : null;
  const targetBuffer = meanBufferMs(video, previous, 'jitterBufferTargetDelay');
  const minimumBuffer = meanBufferMs(video, previous, 'jitterBufferMinimumDelay');
  const audioBuffer = meanBufferMs(audio, previous?.audio, 'jitterBufferDelay');
  const avOffset = finite(audio?.estimatedPlayoutTimestamp) && finite(video.estimatedPlayoutTimestamp)
    ? audio.estimatedPlayoutTimestamp - video.estimatedPlayoutTimestamp : null;
  return { snapshot: { ...video, audio: audio && { ...audio } }, rows: [
    ['接收缓冲与解码', stalled ? '本秒无解码帧' : format(receiving, 'ms'), stalled || receiving >= 100],
    ['实际分辨率', video.frameWidth && video.frameHeight ? `${video.frameWidth} × ${video.frameHeight}` : '—'],
    ['解码帧率', format(fps, 'FPS'), finite(fps) && fps < 10],
    ['视频接收码率', format(kbps, 'kbps', 0), kbps === 0],
    ['网络往返 RTT', format(rtt, 'ms'), rtt >= 150],
    ['接收缓冲耗时', delta('jitterBufferEmittedCount') === 0 ? '本秒无输出帧' : format(buffer, 'ms'), delta('jitterBufferEmittedCount') === 0 || buffer >= 100],
    ['接收目标缓冲', format(targetBuffer, 'ms')],
    ['视频最低缓冲', format(minimumBuffer, 'ms')],
    ...(audio ? [['音频接收缓冲', format(audioBuffer, 'ms')], ['音画播放时间差', format(avOffset, 'ms')]] : []),
    ['平均解码耗时', stalled ? '本秒无解码帧' : format(decode, 'ms'), stalled || decode >= 33],
    ['网络抖动', format(jitter, 'ms'), jitter >= 30],
    ['区间丢包率', format(loss, '%'), loss >= 2],
    ['累计丢帧', format(video.framesDropped, '帧', 0), delta('framesDropped') > 0],
    ['接收完整帧', format(video.framesReceived,'帧',0)],
    ['已解码帧', format(video.framesDecoded,'帧',0)],
    ['已解码关键帧', format(video.keyFramesDecoded,'帧',0)],
    ['关键帧请求数', format(video.pliCount,'次',0)],
    ['视频编码', codec?.mimeType || '—'],
    ['实际解码器', video.decoderImplementation || '当前浏览器未报告'],
    ...(diagnostics ? [
      ['系统硬件解码', diagnostics.hardwareDecodeAvailable ? '可用（实际使用以解码器为准）' : '不可用'],
      ...(diagnostics.publisher ? [['本机推流编码器', diagnostics.publisher.encoder], ['本机推流丢帧', format(diagnostics.publisher.droppedFrames, '帧', 0)]] : []),
      ...(diagnostics.udp?.some(row=>finite(row.queueDelayMs)) ? [
        ['本机媒体排队', format(Math.max(...diagnostics.udp.map(row=>row.queueDelayMs||0)), 'ms')],
        ['本机媒体过载丢包', format(diagnostics.udp.reduce((total,row)=>total+(row.dropped||0),0), '包', 0)],
      ] : []),
    ] : []),
  ] };
}

export function attachVideoStats(container, pc) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'video-debug-button'; button.textContent = '?';
  button.title = '观看诊断信息'; button.setAttribute('aria-label', '观看诊断信息');
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'videoDebugPanel');
  const panel = document.createElement('div');
  panel.id = 'videoDebugPanel'; panel.className = 'video-debug-panel hidden';
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '观看诊断信息');
  container.append(button, panel);
  let timer, previous, disposed = false, generation = 0, pending = false;
  function render(rows) {
    panel.replaceChildren();
    for (const [label, value, abnormal] of rows) {
      const row = document.createElement('div'); row.className = 'video-debug-row';
      row.classList.toggle('is-abnormal', !!abnormal);
      const name = document.createElement('span'), data = document.createElement('strong');
      name.textContent = label; data.textContent = abnormal ? `⚠ ${value}` : value; row.append(name, data); panel.append(row);
    }
  }
  async function refresh(token) {
    if (pending || disposed) return;
    pending = true;
    try {
      const [report, diagnostics] = await Promise.all([pc.getStats(),
        Promise.resolve(globalThis.window?.electronAPI?.getVideoDiagnostics?.()).catch(()=>null)]);
      if (disposed || generation !== token) return;
      const result = sampleVideoStats(report, previous, diagnostics); previous = result.snapshot; render(result.rows);
    } catch {
      if (!disposed && generation === token) render([['状态', '统计暂不可用']]);
    } finally { pending = false; }
  }
  button.onclick = () => {
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open); button.setAttribute('aria-expanded', String(open));
    clearInterval(timer); previous = null; const token = ++generation;
    if (open) { render([['状态', '正在采样…']]); void refresh(token); timer = setInterval(() => void refresh(token), 1000); }
  };
  return () => { disposed = true; generation++; clearInterval(timer); button.remove(); panel.remove(); };
}
