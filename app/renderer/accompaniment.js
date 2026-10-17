import { state } from './shared.js';
import { toast } from './toast.js';
import { WhepSession } from './whep.mjs';
import { createPCMSource } from './pcm-audio.mjs';

const providers = [
  { name: '网易云音乐', mark: '云', color: '#e43226', pattern: /网易云|cloudmusic/i },
  { name: 'QQ 音乐', mark: 'Q', color: '#18b879', pattern: /QQ音乐|QQ Music|qqmusic/i },
  { name: '酷狗音乐', mark: 'K', color: '#268df5', pattern: /酷狗|kugou/i },
  { name: '汽水音乐', mark: '♪', color: '#20252a', pattern: /汽水|soda music/i },
];
let selected = null, busy = false, generation = 0, cleanup, bridge, sink, mix, menu, sources = [];
let menuTrigger;
let pcmSource, pcmSession;
let volume = Math.max(0, Math.min(1, Number(localStorage.getItem('accompanimentVolume') ?? '0.7')));
if (!Number.isFinite(volume)) volume = 0.7;
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3v12a4 4 0 1 1-3-3.9V5l6-2"/><path d="M20 6a9 9 0 1 1-11-3"/></svg>';
function paint() {
  for (const button of document.querySelectorAll('.accompaniment-trigger')) {
    button.classList.toggle('active', !!selected); button.disabled = busy || !!cleanup;
    button.title = selected ? '伴奏播放中' : '播放伴奏';
    button.setAttribute('aria-expanded', String(!!menu));
  }
}
function closeMenu() { menu?.remove(); menu = null; menuTrigger = null; paint(); }
function positionMenu() {
  if (!menu || !menuTrigger) return;
  const anchor = menuTrigger.getBoundingClientRect();
  menu.style.maxHeight = `${Math.max(80, innerHeight - 16)}px`;
  menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, innerHeight - menu.offsetHeight - 8))}px`;
  const list = menu.querySelector('.accompaniment-more-list');
  if (!list || list.classList.contains('hidden')) return;
  list.style.width = `${Math.min(280, innerWidth - 16)}px`;
  list.style.maxHeight = `${Math.max(80, innerHeight - 16)}px`;
  const bounds = menu.getBoundingClientRect();
  const x = bounds.right + list.offsetWidth + 6 <= innerWidth - 8 ? bounds.right + 6 : bounds.left - list.offsetWidth - 6;
  list.style.left = `${Math.max(8, Math.min(x, innerWidth - list.offsetWidth - 8))}px`;
  list.style.top = `${Math.max(8, Math.min(bounds.top, innerHeight - list.offsetHeight - 8))}px`;
}
async function stop() {
  if (cleanup) return cleanup;
  const hadCapture = busy || selected || bridge || sink || mix || pcmSource;
  closeMenu();
  generation++; busy = false; selected = null;
  mix?.dispose(); mix = null;
  sink?.pause(); if (sink) { sink.srcObject = null; sink.remove(); } sink = null;
  bridge?.close(); bridge = null; pcmSession = null;
  const closingPCM = pcmSource?.dispose(); pcmSource = null; paint();
  if (!hadCapture) return;
  cleanup = Promise.all([window.electronAPI.accompanimentStop(), closingPCM, window.channelVoice?.accompanimentState(false)]).catch(error => { toast(error.message, 'error'); }).finally(() => { cleanup = null; paint(); });
  return cleanup;
}
async function start(source) {
  if (busy) return;
  if (selected?.id === source.id) { closeMenu(); return; }
  await stop();
  if (!state.roomId || state.leaving || state.switchingChannel) return;
  const token = ++generation, channel = state.channelId, room = state.roomId;
  const check = () => { if (token !== generation || state.roomId !== room || state.channelId !== channel || state.leaving) throw new Error('伴奏启动已取消'); };
  busy = true; paint(); closeMenu();
  try {
    const result = await window.electronAPI.accompanimentStart(source.id); check();
    let stream;
    if (result?.kind === 'pcm') {
      const sourcePCM = await createPCMSource();
      if (token !== generation) { await sourcePCM.dispose(); return; }
      pcmSource = sourcePCM; pcmSession = result.session; stream = sourcePCM.stream;
    } else {
      const url = result; stream = new MediaStream(); let ready, timer;
      const trackReady = new Promise(resolve => { ready = resolve; });
      bridge = new WhepSession(url, { iceServers: [] }, event => {
        if (token !== generation || event.track.kind !== 'audio') return;
        stream.addTrack(event.track);
        if (event.track.muted) event.track.addEventListener('unmute', ready, { once: true }); else ready();
      }, error => { if (token === generation) { toast(error.message, 'error'); void stop(); } }, { audioOnly: true, stereo: true });
      await bridge.start(); check();
      try { await Promise.race([trackReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('未收到伴奏音频，请确认音源程序正在播放')), 12000); })]); }
      finally { clearTimeout(timer); }
    }
    check();
    sink = new Audio(); sink.hidden = true; sink.volume = 0; sink.srcObject = stream; sink.dataset.accompanimentCapture = 'true'; document.body.append(sink); await sink.play(); check();
    const attachment = await window.channelVoice.mix(stream, volume);
    if (token !== generation) { attachment.dispose(); return; }
    mix = attachment; selected = source; paint();
    await window.channelVoice.accompanimentState(true);
  } catch (error) { if (token === generation) { toast(error.message, 'error'); await stop(); } }
  finally { if (token === generation) { busy = false; paint(); } }
}
async function showMenu(trigger) {
  if (menu) { closeMenu(); return; }
  menu = document.createElement('div'); const current = menu; menuTrigger = trigger;
  sources = [];
  menu.className = 'accompaniment-menu'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '播放伴奏');
  const heading = document.createElement('div'); heading.className = 'accompaniment-heading'; heading.textContent = '伴奏来源';
  menu.append(heading);
  for (const provider of providers) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'accompaniment-source'; button.disabled = true;
    const badge = document.createElement('span'); badge.className = 'music-provider-badge'; badge.style.background = provider.color; badge.textContent = provider.mark;
    button.append(badge, document.createTextNode(provider.name)); button.onclick = () => {
      const source = sources.find(s => provider.pattern.test(s.name));
      if (source) void start(source); else toast(`请先打开${provider.name}并播放音乐`, 'error');
    }; menu.append(button);
  }
  const more = document.createElement('button'); more.type = 'button'; more.disabled = true; more.className = 'accompaniment-source accompaniment-more'; more.textContent = '更多音源'; more.setAttribute('aria-expanded', 'false'); menu.append(more);
  const list = document.createElement('div'); list.className = 'accompaniment-more-list hidden'; menu.append(list);
  more.onclick = () => { list.classList.toggle('hidden'); positionMenu(); more.setAttribute('aria-expanded', String(!list.classList.contains('hidden'))); };
  const divider = document.createElement('div'); divider.className = 'accompaniment-divider'; menu.append(divider);
  const label = document.createElement('label'); label.className = 'accompaniment-volume'; label.textContent = '伴奏音量';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = String(volume * 100); slider.setAttribute('aria-label', '伴奏音量');
  slider.oninput = () => { volume = Number(slider.value) / 100; localStorage.setItem('accompanimentVolume', String(volume)); mix?.volume(volume); }; label.append(slider); menu.append(label);
  if (selected) {
    const end = document.createElement('button'); end.type = 'button'; end.className = 'accompaniment-source accompaniment-stop'; end.textContent = '停止伴奏'; end.onclick = () => { closeMenu(); void stop(); }; menu.append(end);
  }
  document.body.append(menu);
  positionMenu(); paint();
  try {
    sources = await window.electronAPI.accompanimentSources();
    if (menu !== current) return;
    for (const button of current.querySelectorAll('button:disabled')) button.disabled = false;
    for (const source of [...sources, { id: '__system__', name: '全部音源' }]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'accompaniment-source'; button.textContent = source.name.replace(/^窗口\s*·\s*/, ''); button.setAttribute('aria-pressed', String(selected?.id === source.id)); button.onclick = () => void start(source); list.append(button);
    }
    positionMenu();
  } catch (error) { if (menu === current) toast(error.message, 'error'); }
}
function decorate(card) {
  const name = card.querySelector('.name'), row = document.createElement('div'); row.className = 'own-card-name-row'; name.replaceWith(row); row.append(name);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'accompaniment-trigger'; button.innerHTML = icon + '<span class="accompaniment-tooltip">播放伴奏</span>'; button.setAttribute('aria-label', '播放伴奏'); button.onclick = () => void showMenu(button); row.append(button); paint();
}
export function initAccompaniment() {
  window.channelAccompaniment = { decorate, stop, active: () => !!selected || busy };
  document.addEventListener('pointerdown', event => { if (menu && !menu.contains(event.target) && !event.target.closest('.accompaniment-trigger')) closeMenu(); });
  window.addEventListener('resize', positionMenu);
  window.electronAPI.onAccompanimentPCM(message => { if (pcmSource && message.session === pcmSession) pcmSource.feed(message.data); });
  window.electronAPI.onAccompanimentError(message => { toast(message, 'error'); void stop(); });
}
