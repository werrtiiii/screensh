export function preferVideoReceiveLatency(receiver) {
  if (!['video', 'audio'].includes(receiver?.track?.kind)) return null;
  // Configure both synchronized tracks: the larger A/V target can otherwise
  // override the video preference. Zero requests no additional minimum delay.
  for (const property of ['jitterBufferTarget', 'playoutDelayHint']) {
    if (!(property in receiver)) continue;
    try { receiver[property] = 0; return property; } catch {}
  }
  return null;
}
