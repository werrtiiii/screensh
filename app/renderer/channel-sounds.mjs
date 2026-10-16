import { ChannelSoundTracker } from './channel-sound-tracker.mjs';
import { trackSound } from './sound-volume.mjs';
const tracker = new ChannelSoundTracker();
const sources = Object.fromEntries(['enter_voice', 'exit_voice', 'person_enter_voice', 'person_exit_voice'].map(name => [name, new URL(`./assets/sounds/${name}.wav`, import.meta.url).href]));
let queue = Promise.resolve(), epoch = 0, pending = 0, finishCurrent;
function play({ sounds, replace }) {
  if (replace) { epoch++; finishCurrent?.(); queue = Promise.resolve(); pending = 0; }
  const token = epoch;
  for (const name of sounds) {
    if (!sources[name] || pending >= 8) continue;
    pending++;
    queue = queue.then(async () => {
      if (token !== epoch) return;
      pending--;
      const audio = new Audio(sources[name]); const releaseVolume = trackSound(audio);
      try {
        if (audio.setSinkId) {
          const device = localStorage.getItem('voiceSpeaker') || 'default';
          try { await audio.setSinkId(device); } catch { await audio.setSinkId('default'); }
        }
        if (token !== epoch) return;
        await new Promise(resolve => {
          let timer, done = false;
          const finish = () => {
            if (done) return; done = true; clearTimeout(timer); audio.pause();
            audio.onended = audio.onerror = null;
            if (finishCurrent === finish) finishCurrent = null;
            audio.removeAttribute('src'); audio.load(); resolve();
          };
          finishCurrent = finish; audio.onended = audio.onerror = finish;
          timer = setTimeout(finish, 5000); audio.play().catch(finish);
        });
      } catch (error) { console.warn('[Channel sound]', error.message); }
      finally { releaseVolume(); }
    }).catch(error => console.warn('[Channel sound]', error.message));
  }
}
export function syncChannelSounds(snapshot, selfId, restoring = false) {
  play(tracker.update(snapshot, selfId, { silent: restoring }));
}
export function leaveChannelSounds() { play(tracker.leave()); }
