export function channelVoiceBitrate(channels, channelId) {
  const value = channels?.find(channel => channel.id === channelId)?.voiceBitrate;
  return [24, 32, 64, 96].includes(value) ? value : 32;
}
// Negotiate stereo reception in advance so accompaniment can start without
// reconnecting. The mono microphone is upmixed only when music is attached.
export function allowOpusStereo(sdp, maxAverageBitrate = 96000) {
  const opus = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/gmi)].map(match => match[1]);
  for (const payload of opus) {
    const pattern = new RegExp(`^a=fmtp:${payload} (.*)\\r?$`, 'm');
    const match = sdp.match(pattern);
    const parameters = (match?.[1] || '').trim().split(';').map(value => value.trim()).filter(value => value && !/^(stereo|sprop-stereo|maxaveragebitrate)=/i.test(value));
    parameters.push('stereo=1', 'sprop-stereo=1', `maxaveragebitrate=${maxAverageBitrate}`);
    const line = `a=fmtp:${payload} ${parameters.join(';')}`;
    sdp = match ? sdp.replace(pattern, line + (match[0].endsWith('\r') ? '\r' : '')) : sdp.replace(new RegExp(`(a=rtpmap:${payload} [^\\r\\n]+)`), `$1\r\n${line}`);
  }
  return sdp;
}
export async function setVoiceBitrate(pc, kbps) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) continue;
    for (const encoding of parameters.encodings) encoding.maxBitrate = kbps * 1000;
    await sender.setParameters(parameters);
  }
}
