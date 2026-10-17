// Request the lowest adaptive delay, without imposing an extra minimum.
// A zero preference does NOT disable NetEQ's buffering or loss concealment.
export const VOICE_BUFFER_TARGET_MS = 0;
export function preferVoiceReceiveLatency(receiver) {
  if (receiver?.track?.kind !== 'audio') return null;
  // Chromium versions expose different APIs and use different units. In older
  // Chromium playoutDelayHint sets a minimum, so a positive hint can add delay.
  for (const [property, value] of [['jitterBufferTarget', VOICE_BUFFER_TARGET_MS], ['playoutDelayHint', VOICE_BUFFER_TARGET_MS / 1000]]) {
    if (!(property in receiver)) continue;
    try { receiver[property] = value; return property; } catch {}
  }
  return null;
}

// ptime is a media-level receive preference. Advertise it in our own offer
// and answer, without rewriting the remote peer's preferences or the WHEP hop.
export function preferVoicePacketTime(sdp) {
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  return sdp.split(/(?=^m=)/m).map(section => {
    if (!section.startsWith('m=audio ') || !/^a=rtpmap:\d+ opus\/48000\/2\r?$/mi.test(section)) return section;
    const trailingNewline = section.endsWith('\n');
    const lines = section.split(/\r?\n/).filter(line => !/^a=ptime:/.test(line));
    if (trailingNewline) lines.pop();
    lines.push('a=ptime:10');
    return lines.join(newline) + (trailingNewline ? newline : '');
  }).join('');
}
