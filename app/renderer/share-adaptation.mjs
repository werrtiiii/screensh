const finite = value => typeof value === 'number' && Number.isFinite(value);

export function sampleWatchNetwork(report, previous) {
  const video = [...report.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'video');
  if (!video) return { snapshot: null, feedback: null };
  const same = previous?.id === video.id && video.timestamp > previous.timestamp;
  const delta = key => same && finite(video[key]) && finite(previous[key]) && video[key] >= previous[key] ? video[key] - previous[key] : null;
  const received = delta('packetsReceived'), lost = delta('packetsLost'), count = delta('jitterBufferEmittedCount'), delay = delta('jitterBufferDelay');
  const pair = report.get(report.get(video.transportId)?.selectedCandidatePairId);
  return { snapshot: { ...video }, feedback: received !== null && lost !== null && received + lost > 0 ? {
    loss: lost * 100 / (received + lost),
    buffer: count > 0 && delay !== null ? delay * 1000 / count : null,
    rtt: finite(pair?.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null,
    jitter: finite(video.jitter) ? video.jitter * 1000 : null,
  } : null };
}

export function watchNetwork(pc, send) {
  let stopped = false, pending = false, previous;
  const sample = async () => {
    if (stopped || pending || pc.connectionState !== 'connected') return;
    pending = true;
    try {
      const result = sampleWatchNetwork(await pc.getStats(), previous);
      if (stopped) return;
      previous = result.snapshot; if (result.feedback) send(result.feedback);
    } catch {} finally { pending = false; }
  };
  const timer = setInterval(sample, 2000); void sample();
  return () => { stopped = true; clearInterval(timer); };
}

export function createShareAdaptation({ base, width, height, bitrate, change, now = Date.now }) {
  const viewers = new Map();
  const profiles = [base, ...[[1280,720],[854,480]].filter(([w,h]) => w*h < width*height).map(([w,h]) => ({
    ...base, resolution: `${w}x${h}`, maxBitrate: Math.min(bitrate, Math.max(100, Math.round(bitrate * w*h/(width*height)))),
  }))];
  let level = 0, busy = false, closed = false, readyAt = now() + 8000;
  return {
    get level() { return level; },
    close() { closed = true; viewers.clear(); },
    async report(id, metrics) {
      if (closed || busy || !metrics || !finite(metrics.loss)) return;
      const time = now(), previous = viewers.get(id);
      if (previous && time - previous.last < 1500) return;
      for (const [key, value] of viewers) if (time - value.last > 10000) viewers.delete(key);
      const poor = metrics.loss >= 5 || (metrics.loss >= 2 && metrics.jitter >= 20) ||
        (metrics.buffer >= 200 && (metrics.jitter >= 30 || metrics.loss >= 1));
      const good = metrics.loss < 1 && finite(metrics.buffer) && metrics.buffer < 100 &&
        (metrics.jitter === null || metrics.jitter < 30);
      viewers.set(id, { last: time, bad: poor && time >= readyAt ? (previous?.bad || 0) + 1 : 0, goodSince: good ? previous?.goodSince ?? time : null });
      if (time < readyAt) return;
      let next = level;
      if ([...viewers.values()].some(value => value.bad >= 3) && level < profiles.length - 1) next++;
      else if (level > 0 && [...viewers.values()].every(value => value.goodSince !== null && time - value.goodSince >= 20000)) next--;
      if (next === level) return;
      busy = true;
      try { if (await change(profiles[next], profiles[level])) level = next; else closed = true; }
      catch { closed = true; }
      finally { busy = false; viewers.clear(); readyAt = now() + 8000; }
    },
  };
}
