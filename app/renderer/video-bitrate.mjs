// 30 FPS screen-sharing rates, in kbps, at common pixel counts.
const profiles = [
  [854 * 480, 1200],
  [1280 * 720, 2200],
  [1920 * 1080, 3500],
  [2560 * 1440, 5000],
  [3840 * 2160, 7500],
];

export function recommendedVideoBitrate(width, height, frameRate) {
  const pixels = width * height;
  let [basePixels, baseRate] = profiles[0];
  let bitrate = baseRate * pixels / basePixels;
  if (pixels > basePixels) {
    for (const [nextPixels, nextRate] of profiles.slice(1)) {
      if (pixels <= nextPixels) {
        bitrate = baseRate + (nextRate - baseRate) * (pixels - basePixels) / (nextPixels - basePixels);
        break;
      }
      basePixels = nextPixels;
      bitrate = baseRate = nextRate;
    }
  }
  const frameScale = frameRate <= 30 ? 0.6 + (frameRate - 15) * (0.4 / 15) : 1 + (frameRate - 30) * (0.6 / 30);
  return Math.min(10000, Math.max(500, Math.round(bitrate * frameScale / 100) * 100));
}
