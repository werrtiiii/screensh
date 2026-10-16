const active = new Set();
export function getSoundVolume() {
  const saved = localStorage.getItem('softwareSoundVolume');
  const value = saved === null ? 0.6 : Number(saved);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.6;
}
export function setSoundVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return;
  localStorage.setItem('softwareSoundVolume', String(Math.min(1, Math.max(0, volume))));
  for (const audio of active) audio.volume = getSoundVolume();
}
export function trackSound(audio) {
  audio.volume = getSoundVolume();
  active.add(audio);
  return () => active.delete(audio);
}
export function initSoundVolume() {
  const slider = document.querySelector('#softwareSoundVolume');
  const output = document.querySelector('#softwareSoundVolumeValue');
  const paint = () => {
    slider.value = String(Math.round(getSoundVolume() * 100));
    output.textContent = `${slider.value}%`;
    slider.style.setProperty('--range-progress', `${slider.value}%`);
  };
  if (!slider || !output) return;
  slider.addEventListener('input', () => { setSoundVolume(Number(slider.value) / 100); paint(); });
  paint();
}
