import { state } from './shared.js';
import { socket, roomUsers, requestServer } from './signaling.js';
import { toast } from './toast.js';
import { interactions, interactionById } from './interaction-catalog.mjs';

const active = new Map();
let popup = null, anchor = null, cooldownUntil = 0, sending = false, cooldownTimer;
let scope = '', playing = null, audioGeneration = 0;
const seen = new Set();
function closePicker() { popup?.remove(); popup = anchor = null; }
function updateCooldown() {
  const disabled = sending || performance.now() < cooldownUntil;
  document.querySelectorAll('.interaction-trigger, .interaction-choice').forEach(button => { button.disabled = disabled; });
}
function stopSound() {
  audioGeneration++;
  if (!playing) return;
  const { audio, timer } = playing; playing = null;
  clearTimeout(timer); audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load();
}
async function playSound(url) {
  stopSound(); const token = audioGeneration;
  const audio = new Audio(url); audio.volume = 0.6;
  const current = { audio, timer: null }; playing = current;
  const finish = () => { if (playing === current) stopSound(); };
  audio.onended = audio.onerror = finish;
  current.timer = setTimeout(finish, 10000);
  try {
    if (audio.setSinkId) {
      try { await audio.setSinkId(localStorage.getItem('voiceSpeaker') || 'default'); }
      catch { await audio.setSinkId('default'); }
    }
    if (token === audioGeneration) await audio.play();
  } catch { finish(); }
}
function paintEffect(card, event) {
  const cover = card.querySelector('.card-cover');
  if (!cover || cover.dataset.interaction === event.id) return;
  cover.querySelectorAll('.interaction-animation, .interaction-badge').forEach(node => node.remove());
  cover.dataset.interaction = event.id;
  const sticker = interactionById.get(event.sticker);
  const img = event.image || document.createElement('img'); img.className = 'interaction-animation'; img.alt = sticker.name;
  // Unique URL restarts an animated WebP even for repeated identical stickers.
  if (!event.image) img.src = sticker.animation + '?interaction=' + encodeURIComponent(event.id);
  event.image = img;
  const badge = document.createElement('img'); badge.className = 'interaction-badge'; badge.alt = sticker.name; badge.src = sticker.icon;
  cover.append(img, badge);
}
export function receiveInteraction(event) {
  if (!event || event.serverId !== state.roomId || event.channelId !== state.channelId || !socket?.connected
    || !interactionById.has(event.sticker) || typeof event.id !== 'string' || seen.has(event.id)
    || !roomUsers.has(event.from) || !roomUsers.has(event.target)) return;
  seen.add(event.id); if (seen.size > 100) seen.delete(seen.values().next().value);
  const old = active.get(event.target); if (old) clearTimeout(old.timer);
  const effect = { ...event, expires: performance.now() + interactionById.get(event.sticker).duration };
  effect.timer = setTimeout(() => {
    if (active.get(event.target) !== effect) return;
    active.delete(event.target);
    for (const card of document.querySelectorAll('.user-card')) if (card.dataset.userId === event.target) {
      card.querySelectorAll('.interaction-animation, .interaction-badge').forEach(node => node.remove());
      const cover = card.querySelector('.card-cover'); if (cover) delete cover.dataset.interaction;
    }
  }, interactionById.get(event.sticker).duration);
  active.set(event.target, effect);
  for (const card of document.querySelectorAll('.user-card')) if (card.dataset.userId === event.target) paintEffect(card, effect);
  if (socket.id === event.from || socket.id === event.target) void playSound(interactionById.get(event.sticker).sound);
}
export function resetInteractions() {
  closePicker(); stopSound(); clearTimeout(cooldownTimer);
  for (const effect of active.values()) clearTimeout(effect.timer);
  active.clear(); seen.clear(); sending = false; cooldownUntil = 0; scope = '';
  document.querySelectorAll('.interaction-animation, .interaction-badge').forEach(node => node.remove());
}
export function syncInteractions() {
  const next = `${state.roomId}:${state.channelId}:${socket?.id}`;
  if (scope !== next) { resetInteractions(); scope = next; }
  closePicker();
  for (const [id, effect] of active) if (!roomUsers.has(id)) { clearTimeout(effect.timer); active.delete(id); }
}
async function sendInteraction(target, sticker) {
  if (sending || performance.now() < cooldownUntil || !socket?.connected || state.leaving || state.switchingChannel) return;
  const currentScope = scope;
  sending = true; cooldownUntil = performance.now() + 1000; closePicker(); updateCooldown();
  clearTimeout(cooldownTimer); cooldownTimer = setTimeout(updateCooldown, 1010);
  try { await requestServer('interact', { target, sticker }); }
  catch (error) { if (scope === currentScope) toast(error.message, 'error'); }
  finally { if (scope === currentScope) { sending = false; updateCooldown(); } }
}
function showPicker(button, target) {
  if (anchor === button) { closePicker(); return; }
  closePicker(); anchor = button;
  popup = document.createElement('div'); popup.className = 'interaction-picker'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '选择互动');
  for (const sticker of interactions) {
    const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'interaction-choice'; choice.title = sticker.name; choice.setAttribute('aria-label', sticker.name);
    const img = document.createElement('img'); img.src = sticker.icon; img.alt = ''; choice.append(img);
    choice.onclick = () => void sendInteraction(target, sticker.id); popup.append(choice);
  }
  document.body.append(popup);
  const rect = button.getBoundingClientRect(), width = popup.offsetWidth, height = popup.offsetHeight;
  popup.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - height - 8))}px`;
  updateCooldown(); popup.querySelector('button')?.focus();
}
export function decorateInteractionCard(card, user, isMe) {
  card.dataset.userId = user.socketId;
  const effect = active.get(user.socketId);
  if (effect && effect.expires > performance.now()) paintEffect(card, effect);
  if (isMe) return;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'interaction-trigger'; button.title = '互动'; button.setAttribute('aria-label', `与 ${user.name} 互动`); button.textContent = '👊';
  button.onclick = event => { event.stopPropagation(); showPicker(button, user.socketId); };
  card.querySelector('.card-cover')?.append(button); updateCooldown();
}
document.addEventListener('pointerdown', event => { if (popup && !popup.contains(event.target) && !anchor?.contains(event.target)) closePicker(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { const button = anchor; closePicker(); button?.focus(); } });
window.addEventListener('resize', closePicker);
window.addEventListener('scroll', event => { if (popup && !popup.contains(event.target)) closePicker(); }, true);
