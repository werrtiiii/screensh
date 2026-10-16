const finite = value => Number.isFinite(value);
export function sampleVideoStats(report, previous) {
  const entries = [...report.values()];
  const video = entries.find(s => s.type === 'inbound-rtp' && s.kind === 'video');
  if (!video) return { snapshot: null, rows: [['状态', '等待视频数据…']] };
  const same = previous?.id === video.id && video.timestamp > previous.timestamp;
  const delta = key => same && finite(video[key]) && finite(previous[key]) && video[key] >= previous[key] ? video[key] - previous[key] : null;
  const elapsed = same ? (video.timestamp - previous.timestamp) / 1000 : null;
  const perSecond = key => delta(key) === null ? null : delta(key) / elapsed;
  const meanMs = (total, count) => delta(total) !== null && delta(count) > 0 ? 1000 * delta(total) / delta(count) : null;
  const format = (value, unit, digits = 1) => finite(value) ? `${value.toFixed(digits)} ${unit}` : '—';
  const transport = report.get(video.transportId);
  const pair = report.get(transport?.selectedCandidatePairId);
  const codec = report.get(video.codecId);
  const received = delta('packetsReceived'), lost = delta('packetsLost');
  const fps = perSecond('framesDecoded');
  const kbps = perSecond('bytesReceived') === null ? null : perSecond('bytesReceived') * 8 / 1000;
  const rtt = finite(pair?.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null;
  const buffer = meanMs('jitterBufferDelay', 'jitterBufferEmittedCount');
  const decode = meanMs('totalDecodeTime', 'framesDecoded');
  const jitter = finite(video.jitter) ? video.jitter * 1000 : null;
  const loss = received !== null && lost !== null && received + lost > 0 ? lost / (received + lost) * 100 : null;
  const stalled = fps === 0;
  // Scenario estimate, NOT a measurement or guaranteed bound: assume symmetric RTT,
  // 30 FPS capture (0–33 ms), 60 Hz display (0–17 ms), encode 5–30 ms,
  // and local publishing/forwarding queue 0–20 ms. These stages aren't measured.
  const base = !stalled && [rtt, buffer, decode].every(finite) ? rtt / 2 + buffer + decode : null;
  const estimate = stalled ? '暂停估算：本秒无解码帧' : base === null ? '等待完整采样' : `约 ${Math.round(base + 5)}–${Math.round(base + 100)} ms`;
  return { snapshot: { ...video }, rows: [
    ['总画面延迟（估算）', estimate, stalled || (base !== null && base + 100 >= 300)],
    ['实际分辨率', video.frameWidth && video.frameHeight ? `${video.frameWidth} × ${video.frameHeight}` : '—'],
    ['解码帧率', format(fps, 'FPS'), finite(fps) && fps < 10],
    ['视频接收码率', format(kbps, 'kbps', 0), kbps === 0],
    ['网络往返 RTT', format(rtt, 'ms'), rtt >= 150],
    ['接收缓冲耗时', delta('jitterBufferEmittedCount') === 0 ? '本秒无输出帧' : format(buffer, 'ms'), delta('jitterBufferEmittedCount') === 0 || buffer >= 100],
    ['平均解码耗时', stalled ? '本秒无解码帧' : format(decode, 'ms'), stalled || decode >= 33],
    ['网络抖动', format(jitter, 'ms'), jitter >= 30],
    ['区间丢包率', format(loss, '%'), loss >= 2],
    ['累计丢帧', format(video.framesDropped, '帧', 0), delta('framesDropped') > 0],
    ['视频编码', codec?.mimeType || '—'],
  ] };
}

export function attachVideoStats(container, pc) {
  const button = document.createElement('button');
  button.className = 'video-debug-button'; button.textContent = '调试';
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'videoDebugPanel');
  const panel = document.createElement('div');
  panel.id = 'videoDebugPanel'; panel.className = 'video-debug-panel hidden';
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
      const report = await pc.getStats();
      if (disposed || generation !== token) return;
      const result = sampleVideoStats(report, previous); previous = result.snapshot; render(result.rows);
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
