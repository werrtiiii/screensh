const finite = value => typeof value === 'number' && Number.isFinite(value);
function counterDelta(current, previous, key) {
  if (!current || !previous || current.id !== previous.id || !(current.timestamp > previous.timestamp)) return null;
  return finite(current[key]) && finite(previous[key]) && current[key] >= previous[key] ? current[key] - previous[key] : null;
}
const averageMs = (duration, count) => duration !== null && count > 0 ? duration * 1000 / count : null;
const rate = (value, seconds) => value !== null && seconds > 0 ? value / seconds : null;
export function sampleVoiceStats(report, previous, previousOutbound) {
  const audio = [...report.values()].find(s => s.type === 'inbound-rtp' && (s.kind === 'audio' || s.mediaType === 'audio') && !s.isRemote);
  const outbound = [...report.values()].find(s => s.type === 'outbound-rtp' && (s.kind === 'audio' || s.mediaType === 'audio'));
  const transport = report.get(audio?.transportId || outbound?.transportId);
  const pair = report.get(transport?.selectedCandidatePairId);
  const local = report.get(pair?.localCandidateId), remote = report.get(pair?.remoteCandidateId);
  const delta = key => counterDelta(audio, previous, key);
  const sentDelta = key => counterDelta(outbound, previousOutbound, key);
  const received = delta('packetsReceived'), lost = delta('packetsLost'), emitted = delta('jitterBufferEmittedCount');
  const seconds = audio && previous ? (audio.timestamp - previous.timestamp) / 1000 : 0;
  const sentSeconds = outbound && previousOutbound ? (outbound.timestamp - previousOutbound.timestamp) / 1000 : 0;
  const sent = sentDelta('packetsSent'), samples = delta('totalSamplesReceived'), concealed = delta('concealedSamples');
  const source = report.get(outbound?.mediaSourceId);
  const codec = report.get(audio?.codecId || outbound?.codecId);
  return {
    snapshot: audio ? { ...audio } : null,
    outboundSnapshot: outbound ? { ...outbound } : null,
    sendKbps: rate(sentDelta('bytesSent'), sentSeconds) === null ? null : rate(sentDelta('bytesSent'), sentSeconds) * 8 / 1000,
    sendPacketsPerSecond: rate(sent, sentSeconds),
    receivePacketsPerSecond: rate(received, seconds),
    sendQueue: averageMs(sentDelta('totalPacketSendDelay'), sent),
    bufferTarget: averageMs(delta('jitterBufferTargetDelay'), emitted),
    bufferMinimum: averageMs(delta('jitterBufferMinimumDelay'), emitted),
    discarded: delta('packetsDiscarded'),
    concealment: concealed !== null && samples > 0 ? 100 * concealed / samples : null,
    concealmentEvents: delta('concealmentEvents'),
    echoReturnLoss: finite(source?.echoReturnLoss) ? source.echoReturnLoss : null,
    echoReturnLossEnhancement: finite(source?.echoReturnLossEnhancement) ? source.echoReturnLossEnhancement : null,
    codecSampleRate: finite(codec?.clockRate) ? codec.clockRate : null,
    codecChannels: finite(codec?.channels) ? codec.channels : null,
    rtt: finite(pair?.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null,
    jitter: finite(audio?.jitter) ? audio.jitter * 1000 : null,
    loss: received !== null && lost !== null && received + lost > 0 ? 100 * lost / (received + lost) : null,
    buffer: averageMs(delta('jitterBufferDelay'), emitted),
    kbps: rate(delta('bytesReceived'), seconds) === null ? null : rate(delta('bytesReceived'), seconds) * 8 / 1000,
    codec: codec?.mimeType || null,
    transport: local?.protocol || null,
    relayed: local?.candidateType === 'relay' || remote?.candidateType === 'relay',
  };
}

export function attachVoiceStats(details, { getPeers, getCapture }) {
  if (!details) return () => {};
  const panel = details.querySelector('.voice-diagnostics-body');
  let timer, pending = false, generation = 0, disposed = false;
  const previous = new Map();
  const format = (value, unit, digits = 0) => finite(value) ? `${value.toFixed(digits)} ${unit}` : '—';
  function row(container, label, value) {
    const item = document.createElement('div'); item.className = 'voice-diagnostics-row';
    const name = document.createElement('span'), data = document.createElement('strong'); name.textContent = label; data.textContent = value;
    item.append(name, data); container.append(item);
  }
  async function refresh(token) {
    if (pending || disposed || !details.open) return;
    pending = true;
    try {
      const peers = getPeers(), capture = getCapture(), settings = capture.track?.getSettings() || {};
      const results = await Promise.all(peers.map(async peer => {
        try { return { peer, sample: sampleVoiceStats(await peer.pc.getStats(), previous.get(peer.pc)?.inbound, previous.get(peer.pc)?.outbound) }; }
        catch { return { peer, sample: null }; }
      }));
      if (disposed || token !== generation || !details.open) return;
      const current = new Set(getPeers().map(peer => peer.pc));
      for (const pc of previous.keys()) if (!current.has(pc)) previous.delete(pc);
      panel.replaceChildren();
      row(panel, '频道语音', capture.enabled ? '已连接' : '未连接');
      row(panel, '设备报告采集延迟', format(finite(settings.latency) ? settings.latency * 1000 : null, 'ms', 1));
      const status = value => value === true ? '已开启' : value === false ? '已关闭' : '设备未报告';
      row(panel, '降噪（设备报告）', status(settings.noiseSuppression));
      row(panel, '回声消除（设备报告）', status(settings.echoCancellation));
      row(panel, '自动增益（设备报告）', status(settings.autoGainControl));
      row(panel, '麦克风发送路径', capture.mixed ? '经过音量 / 伴奏混音' : capture.track ? '直接发送采集轨道' : '—');
      if (!peers.length) row(panel, '成员连接', '暂无连接，等待其他成员加入语音');
      for (const { peer, sample } of results) {
        if (!current.has(peer.pc)) continue;
        const section = document.createElement('section'); section.className = 'voice-diagnostics-peer';
        const title = document.createElement('h4'); title.textContent = peer.name; section.append(title);
        row(section, '连接状态', ({ connected: '已连接', connecting: '连接中', disconnected: '连接中断', failed: '连接失败', closed: '已关闭', new: '准备连接' })[peer.pc.connectionState] || '未知');
        if (peer.pc.connectionState === 'connected' && sample) {
          previous.set(peer.pc, { inbound: sample.snapshot, outbound: sample.outboundSnapshot });
          row(section, '单程网络估算（RTT ÷ 2）', format(finite(sample.rtt) ? sample.rtt / 2 : null, 'ms', 1));
          row(section, '接收缓冲延迟（区间）', format(sample.buffer, 'ms', 1));
          row(section, '网络抖动', format(sample.jitter, 'ms', 1));
          row(section, '音频接收码率', format(sample.kbps, 'kbps', 1));
          row(section, '音频编码', sample.codec || '—');
          // This describes WebRTC only; the EasyTier underlay may still relay traffic.
          row(section, 'WebRTC 传输', sample.transport ? `${sample.transport.toUpperCase()}${sample.relayed ? ' · TURN 中继' : ''}` : '—');
        } else { previous.delete(peer.pc); row(section, '统计', sample ? '等待媒体连接' : '暂不可用'); }
        panel.append(section);
      }
    } finally { pending = false; }
  }
  function toggle() {
    clearInterval(timer); previous.clear(); const token = ++generation;
    if (!details.open || disposed) return;
    void refresh(token); timer = setInterval(() => void refresh(token), 1000);
  }
  const observer = new MutationObserver(() => { if (details.closest('.modal')?.classList.contains('hidden')) details.open = false; });
  const modal = details.closest('.modal'); if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  details.addEventListener('toggle', toggle);
  return () => { disposed = true; generation++; clearInterval(timer); previous.clear(); observer.disconnect(); details.removeEventListener('toggle', toggle); };
}
