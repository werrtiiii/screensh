import { state, $ } from './shared.js';
import { socket, requestServer } from './signaling.js';
import { WhepSession } from './whep.mjs';
import { toast } from './toast.js';

const voice = { enabled: false, busy: false, muted: localStorage.getItem('voiceMuted') === 'true', deafened: localStorage.getItem('voiceDeafened') === 'true', testing: false, channel: null };
const peers = new Map(), levels = new Map(), volumes = new Map();
let announcedSpeaking = null;
let capturePending, cancelCaptureWait;
const peerRetries = new Map(), peerRetryCounts = new Map();
let attemptedChannel = null;
let microphoneVolume = Math.max(0, Math.min(1, Number(localStorage.getItem('voiceMicVolume') ?? 1) || 0));
let generation = 0, context, outgoing, rawStream, micGain, source, localMeter, cleanup, bridge, captureAudio, voiceDestination;
let testGeneration = 0, testBusy = false, testAudio, testStream, testMeter, testCleanup, testOwnsCapture = false;
let changingMicrophone = false, microphoneDevices = [];
const microphone = () => localStorage.getItem('voiceMicrophone') || 'default';
const speaker = () => localStorage.getItem('voiceSpeaker') || 'default';
function announce(error) { toast(error.message || String(error), 'error'); }
function createVoiceAudioContext() {
  try { return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }); }
  catch { return new AudioContext({ latencyHint: 'interactive' }); }
}
async function waitForAudioReady(audio) {
  if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  await new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); audio.removeEventListener('loadedmetadata', finish); audio.removeEventListener('canplay', finish); resolve(); };
    const timer = setTimeout(finish, 1500);
    audio.addEventListener('loadedmetadata', finish, { once: true });
    audio.addEventListener('canplay', finish, { once: true });
  });
}
function candidateAllowed(candidate, ip) { return candidate?.split(' ')[4] === ip; }
function onlyVirtualSDP(description, ip) {
  return { type: description.type, sdp: description.sdp.split('\r\n').filter(line => !line.startsWith('a=candidate:') || candidateAllowed(line.slice(2), ip)).join('\r\n') };
}
function speaking(id, active) {
  levels.set(id, active);
  for (const card of document.querySelectorAll('.user-card')) if (card.dataset.userId === id) card.classList.toggle('is-speaking', active);
  if (id === socket?.id && socket?.connected && voice.enabled) {
    const key = `${id}:${state.channelId}:${active}`;
    if (announcedSpeaking !== key) { announcedSpeaking = key; socket.emit('voice-activity', { speaking: !!active }); }
  }
}
export function receiveVoiceActivity({ from, speaking: active }) {
  const user = state.serverUsers.find(u => u.socketId === from && u.channelId === state.channelId);
  if (!user || typeof active !== 'boolean') return;
  user.voiceSpeaking = active && !!user.voiceEnabled && !user.voiceMuted && (!user.microphoneMuted || user.accompanimentActive);
  speaking(from, user.voiceSpeaking);
}
function meter(stream, id, allowed, audioContext = context, isTest = false) {
  const input = audioContext.createMediaStreamSource(stream), analyser = audioContext.createAnalyser(); analyser.fftSize = 512; input.connect(analyser);
  // An unconnected analyser can be skipped by Chromium's audio graph. Pull it
  // through a silent sink without playing another copy of the microphone.
  const silent = audioContext.createGain(); silent.gain.value = 0; analyser.connect(silent); silent.connect(audioContext.destination);
  const samples = new Float32Array(analyser.fftSize); let last = 0, heard = false;
  const started = Date.now();
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const threshold = !isTest && id === socket?.id && window.channelAccompaniment?.active() ? 0.0015 : 0.015;
    if (allowed() && rms > threshold) last = Date.now();
    if (!isTest) speaking(id, allowed() && Date.now() - last < 220);
    if ((isTest || id === socket?.id && !voice.testing) && $('#microphoneLevel')) $('#microphoneLevel').value = allowed() ? Math.min(1, rms * 6) : 0;
    if (isTest) {
      if (rms > 0.003) heard = true;
      const status = $('#voiceTestStatus');
      if (status && !heard && Date.now() - started > 3000) {
        status.textContent = '未检测到声音';
        status.classList.remove('hidden');
      } else if (status && heard) status.classList.add('hidden');
    }
  }, 80);
  return () => { clearInterval(timer); input.disconnect(); analyser.disconnect(); silent.disconnect(); if (!isTest) speaking(id, false); };
}
async function route(audio) {
  audio.autoplay = true;
  audio.muted = false;
  audio.volume = 1;
  if (!audio.setSinkId) return;
  try { await audio.setSinkId(speaker()); }
  catch (error) {
    // A disconnected saved output device must not make the microphone test
    // appear silent. Fall back to the system output and keep the saved choice
    // for the next refresh.
    if (speaker() !== 'default') {
      try { await audio.setSinkId('default'); return; } catch {}
    }
    throw error;
  }
}
function closePeer(id) {
  const peer = peers.get(id); if (!peer) return;
  peers.delete(id); peer.disposeMeter?.(); peer.pc.close(); peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove(); speaking(id, false);
}
function applyMute() {
  const me = state.serverUsers.find(u => u.socketId === socket?.id);
  if (micGain) micGain.gain.value = voice.muted || me?.voiceMuted ? 0 : microphoneVolume;
  for (const [id, peer] of peers) {
    const user = state.serverUsers.find(u => u.socketId === id);
    peer.audio.muted = voice.deafened || !!user?.voiceMuted;
    peer.audio.volume = volumes.get(id) ?? 1;
  }
}
async function signal(id, data) { await requestServer('voice-signal', { to: id, data }); }
function remoteMeter(peer, id) {
  let disposed = false, pending = false, previous, last = 0;
  const sample = async () => {
    if (disposed || pending) return;
    pending = true;
    try {
      const user = state.serverUsers.find(u => u.socketId === id);
      if (typeof user?.voiceSpeaking === 'boolean') {
        speaking(id, !!user.voiceEnabled && !user.voiceMuted && user.voiceSpeaking);
        return;
      }
      const stats = await peer.pc.getStats();
      if (disposed || peers.get(id) !== peer) return;
      const audio = [...stats.values()].find(s => s.type === 'inbound-rtp' && (s.kind === 'audio' || s.mediaType === 'audio') && !s.isRemote);
      const allowed = !voice.deafened && !state.serverUsers.find(u => u.socketId === id)?.voiceMuted;
      let rms = 0;
      if (audio && previous && audio.packetsReceived > previous.packetsReceived) {
        if (Number.isFinite(audio.audioLevel)) rms = audio.audioLevel;
        else {
          const duration = audio.totalSamplesDuration - previous.totalSamplesDuration;
          const energy = audio.totalAudioEnergy - previous.totalAudioEnergy;
          if (duration > 0 && energy >= 0) rms = Math.sqrt(energy / duration);
        }
      }
      previous = audio && { packetsReceived: audio.packetsReceived, totalSamplesDuration: audio.totalSamplesDuration, totalAudioEnergy: audio.totalAudioEnergy };
      if (allowed && rms > 0.015) last = Date.now();
      speaking(id, allowed && Date.now() - last < 220);
    } catch { if (!disposed) speaking(id, false); }
    finally { pending = false; }
  };
  const timer = setInterval(sample, 100); void sample();
  return () => { disposed = true; clearInterval(timer); speaking(id, false); };
}
function ensurePeer(user) {
  if (peers.has(user.socketId)) return peers.get(user.socketId);
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  const audio = document.createElement('audio'); audio.autoplay = true; audio.hidden = true; document.body.append(audio);
  const peer = { pc, audio, queued: [], chain: Promise.resolve() }; peers.set(user.socketId, peer);
  outgoing.getAudioTracks().forEach(track => pc.addTrack(track, outgoing));
  pc.onicecandidate = event => {
    if (event.candidate && candidateAllowed(event.candidate.candidate, state.virtualIp)) signal(user.socketId, { candidate: event.candidate.toJSON() }).catch(announce);
  };
  pc.ontrack = async event => {
    if (event.track.kind !== 'audio' || peers.get(user.socketId) !== peer) return;
    const stream = new MediaStream([event.track]); audio.srcObject = stream;
    // Read the received WebRTC audio level directly. A second Web Audio
    // consumer of a remote track can remain silent while playback is audible.
    peer.disposeMeter?.(); peer.disposeMeter = remoteMeter(peer, user.socketId);
    try {
      await route(audio);
      if (peers.get(user.socketId) !== peer) return;
      applyMute(); await waitForAudioReady(audio);
      if (peers.get(user.socketId) === peer) await audio.play();
    } catch (error) { if (peers.get(user.socketId) === peer) announce(error); }
  };
  pc.onconnectionstatechange = () => {
    if (peers.get(user.socketId) !== peer) return;
    if (pc.connectionState === 'connected') { peerRetryCounts.delete(user.socketId); clearTimeout(peerRetries.get(user.socketId)); peerRetries.delete(user.socketId); }
    else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') schedulePeerRetry(user);
  };
  return peer;
}
function schedulePeerRetry(user) {
  if (peerRetries.has(user.socketId) || !voice.enabled || !socket?.connected) return;
  const count = peerRetryCounts.get(user.socketId) || 0;
  if (count >= 5) { closePeer(user.socketId); toast(`与 ${user.name} 的语音重连失败，请重新加入频道`, 'error'); return; }
  peerRetryCounts.set(user.socketId, count + 1);
  peerRetries.set(user.socketId, setTimeout(() => {
    peerRetries.delete(user.socketId);
    if (!voice.enabled || !socket?.connected || !state.serverUsers.some(u => u.socketId === user.socketId && u.channelId === state.channelId && u.voiceEnabled)) return;
    closePeer(user.socketId);
    if (socket.id < user.socketId) void offer(user);
    else void signal(user.socketId, { restart: true }).catch(announce);
  }, Math.min(5000, 500 * 2 ** count)));
}
async function offer(user) {
  const peer = ensurePeer(user);
  try { await peer.pc.setLocalDescription(await peer.pc.createOffer()); await signal(user.socketId, { description: onlyVirtualSDP(peer.pc.localDescription, state.virtualIp) }); }
  catch (error) { if (peers.get(user.socketId) === peer) { closePeer(user.socketId); announce(error); schedulePeerRetry(user); } }
}
export function receiveVoice({ from, data }) {
  const user = state.serverUsers.find(u => u.socketId === from && u.channelId === state.channelId && u.voiceEnabled);
  if (!voice.enabled || !outgoing || !user) return;
  if (data?.restart === true) { if (socket.id < from) schedulePeerRetry(user); return; }
  const peer = ensurePeer(user);
  peer.chain = peer.chain.then(async () => {
    if (data.description) {
      if (!['offer', 'answer'].includes(data.description.type) || typeof data.description.sdp !== 'string') return;
      await peer.pc.setRemoteDescription(onlyVirtualSDP(data.description, user.virtualIp));
      for (const candidate of peer.queued.splice(0)) await peer.pc.addIceCandidate(candidate);
      if (data.description.type === 'offer') {
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await signal(from, { description: onlyVirtualSDP(peer.pc.localDescription, state.virtualIp) });
      }
    } else if (data.candidate && candidateAllowed(data.candidate.candidate, user.virtualIp)) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate); else peer.queued.push(data.candidate);
    }
  }).catch(error => { if (peers.get(from) === peer) announce(error); });
}
export function syncVoice() {
  if ((voice.enabled || voice.busy) && voice.channel && (voice.channel !== state.channelId || !state.roomId)) { void stopVoice().then(syncVoice); return; }
  applyMute();
  for (const user of state.serverUsers) if (user.socketId !== socket?.id && user.channelId === state.channelId && typeof user.voiceSpeaking === 'boolean') speaking(user.socketId, !!user.voiceEnabled && !user.voiceMuted && user.voiceSpeaking);
  if (voice.enabled && outgoing) {
    const users = state.serverUsers.filter(u => u.socketId !== socket?.id && u.channelId === state.channelId && u.voiceEnabled);
    for (const id of peers.keys()) if (!users.some(u => u.socketId === id)) closePeer(id);
    for (const user of users) if (!peers.has(user.socketId) && !peerRetries.has(user.socketId) && socket.id < user.socketId) void offer(user);
  }
  paintControls();
  const key = `${socket?.id}:${state.channelId}`;
  if (socket?.connected && state.roomId && state.channelId && state.virtualIp && !state.leaving && !state.switchingChannel && !changingMicrophone && !voice.enabled && !voice.busy && !cleanup && (!voice.muted || !voice.deafened) && attemptedChannel !== key) {
    attemptedChannel = key; void startVoice();
  }
}
async function capture() {
  const token = generation;
  const url = await window.electronAPI.voiceStart(microphone());
  if (token !== generation) throw new Error('语音启动已取消');
  context ||= createVoiceAudioContext(); await context.resume();
  if (token !== generation) throw new Error('语音启动已取消');
  const stream = new MediaStream();
  let ready;
  const trackReady = new Promise((resolve, reject) => { ready = resolve; cancelCaptureWait = () => reject(new Error('麦克风采集已取消')); });
  // Register the rejection handler before negotiation can fail.
  trackReady.catch(() => {});
  // Voice capture is audio-only. The OBS voice publisher still provides the
  // capture bridge, while peer audio remains direct over EasyTier.
  bridge = new WhepSession(url, { iceServers: [] }, event => {
    if (token !== generation) return;
    if (event.track.kind === 'audio') {
      const track = event.track;
      stream.addTrack(track);
      // WebRTC can deliver the track event while the track is still muted.
      // Starting the test at that point intermittently creates a silent or
      // noisy clone, so wait for the first real audio frame.
      if (track.muted) track.addEventListener('unmute', ready, { once: true });
      else ready();
    }
  }, error => { announce(error); void stopVoice(); }, { audioOnly: true });
  await bridge.start();
  let timer;
  try { await Promise.race([trackReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('未收到 OBS 麦克风轨道')), 12000); })]); }
  finally { clearTimeout(timer); cancelCaptureWait = null; }
  if (token !== generation) throw new Error('语音启动已取消');
  // Chromium's remote WebRTC audio source needs an active media-element
  // consumer even when Web Audio is its only audible/forwarding consumer.
  // Keep that consumer for the capture lifetime, independent of mic testing.
  const sink = captureAudio = new Audio();
  sink.hidden = true; sink.autoplay = true; sink.volume = 0;
  sink.dataset.voiceCapture = 'true'; sink.srcObject = stream; document.body.append(sink);
  await sink.play();
  if (token !== generation) throw new Error('语音启动已取消');
  rawStream = stream; source = context.createMediaStreamSource(stream); micGain = context.createGain();
  const destination = voiceDestination ||= context.createMediaStreamDestination(); source.connect(micGain); micGain.connect(destination); outgoing = destination.stream;
  localMeter?.();
  localMeter = meter(outgoing, socket?.id, () => (!voice.muted || window.channelAccompaniment?.active()) && !state.serverUsers.find(u => u.socketId === socket?.id)?.voiceMuted);
  applyMute(); return outgoing;
}
function ensureCapture() {
  if (rawStream && context?.state !== 'closed') return Promise.resolve(outgoing);
  if (!capturePending) capturePending = capture().finally(() => { capturePending = null; });
  return capturePending;
}
async function startVoice() {
  if (voice.busy || voice.enabled || testBusy) return;
  if (cleanup) await cleanup;
  if (voice.busy || voice.enabled || testBusy || !state.roomId || state.leaving || state.switchingChannel) return;
  const token = ++generation; voice.busy = true; voice.channel = state.channelId; paintControls();
  try {
    if (voice.testing && testOwnsCapture && outgoing) {
      testOwnsCapture = false; localMeter?.();
      localMeter = meter(outgoing, socket?.id, () => (!voice.muted || window.channelAccompaniment?.active()) && !state.serverUsers.find(u => u.socketId === socket?.id)?.voiceMuted);
    } else await ensureCapture();
    if (token !== generation) throw new Error('语音启动已取消');
    voice.enabled = true;
    await requestServer('set-voice-state', { enabled: true, muted: voice.muted });
    if (token === generation) syncVoice();
  } catch (error) { if (token === generation) { announce(error); await stopVoice({ keepTest: true }); attemptedChannel = `${socket?.id}:${state.channelId}`; } }
  finally { if (token === generation) { voice.busy = false; paintControls(); } }
}
async function startMicrophoneTest() {
  if (testBusy || voice.testing || voice.busy || cleanup) return;
  if (testCleanup) await testCleanup;
  if (testBusy || voice.testing || voice.busy || cleanup) return;
  const token = ++testGeneration; testBusy = true; paintControls();
  try {
    if (!voice.enabled) { testOwnsCapture = true; await ensureCapture(); }
    if (token !== testGeneration) return;
    voice.testing = true;
    const stream = rawStream;
    testStream = new MediaStream(stream.getAudioTracks().map(track => track.clone()));
    testStream.getAudioTracks().forEach(track => { track.enabled = true; });
    testMeter = meter(testStream, 'microphone-test', () => true, context, true);
    testAudio = new Audio(); testAudio.hidden = true; testAudio.dataset.microphoneTest = 'true'; document.body.append(testAudio); testAudio.srcObject = testStream;
    await route(testAudio); testAudio.load(); await waitForAudioReady(testAudio); if (token === testGeneration) await testAudio.play();
  } catch (error) { if (token === testGeneration) { announce(error); await stopMicrophoneTest(); } }
  finally { if (token === testGeneration) { testBusy = false; paintControls(); syncVoice(); } }
}
function stopMicrophoneTest({ keepCapture = false } = {}) {
  if (testCleanup) return testCleanup;
  testGeneration++; testBusy = false; voice.testing = false;
  testMeter?.(); testMeter = null;
  testAudio?.pause(); if (testAudio) { testAudio.srcObject = null; testAudio.remove(); } testAudio = null;
  testStream?.getTracks().forEach(track => track.stop()); testStream = null;
  if ($('#microphoneLevel')) $('#microphoneLevel').value = 0;
  if ($('#voiceTestStatus')) $('#voiceTestStatus').classList.add('hidden');
  const releaseCapture = testOwnsCapture;
  testOwnsCapture = false;
  paintControls();
  if (releaseCapture && !keepCapture) testCleanup = stopVoice({ keepTest: true, releaseCapture: true }).finally(() => { testCleanup = null; paintControls(); });
  else testCleanup = Promise.resolve().finally(() => { testCleanup = null; paintControls(); });
  return testCleanup;
}
export function stopVoice({ keepTest = false, releaseCapture = false } = {}) {
  const stoppingAccompaniment = window.channelAccompaniment?.stop();
  const stoppingTest = keepTest ? Promise.resolve() : stopMicrophoneTest();
  if (cleanup) return Promise.all([cleanup, stoppingTest, stoppingAccompaniment]);
  const preserveCapture = keepTest && !releaseCapture && (voice.testing || testBusy);
  attemptedChannel = null; if (!preserveCapture) generation++; announcedSpeaking = null;
  for (const timer of peerRetries.values()) clearTimeout(timer); peerRetries.clear(); peerRetryCounts.clear();
  const wasEnabled = voice.enabled; voice.enabled = false; voice.busy = false; voice.channel = null;
  for (const id of [...peers.keys()]) closePeer(id);
  localMeter?.(); localMeter = null;
  if (preserveCapture) {
    testOwnsCapture = true; applyMute(); paintControls();
    return Promise.all([stoppingAccompaniment, wasEnabled && socket?.connected ? requestServer('set-voice-state', { enabled: false }) : Promise.resolve()]);
  }
  cancelCaptureWait?.();
  const pendingCapture = capturePending;
  outgoing?.getTracks().forEach(track => track.stop()); outgoing = null; rawStream = null;
  source?.disconnect(); micGain?.disconnect(); source = micGain = voiceDestination = null;
  captureAudio?.pause(); if (captureAudio) { captureAudio.srcObject = null; captureAudio.remove(); } captureAudio = null;
  bridge?.close(); bridge = null; const closing = context?.close(); context = null;
  if (!voice.testing && $('#microphoneLevel')) $('#microphoneLevel').value = 0;
  paintControls();
  cleanup = Promise.allSettled([stoppingTest, stoppingAccompaniment, closing, pendingCapture?.catch(() => {}), window.electronAPI.voiceStop(), wasEnabled && socket?.connected ? requestServer('set-voice-state', { enabled: false }) : Promise.resolve()]).then(results => {
    const failed = results.find(r => r.status === 'rejected'); if (failed) announce(failed.reason);
  }).finally(() => { cleanup = null; });
  return cleanup;
}
function voiceIcon(kind, off = false) {
  const path = kind === 'mute' ? '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>' : '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${path}${off ? '<path d="M2 2l20 20"/>' : ''}</svg>`;
}
async function changeVoicePreference(mode) {
  if (mode === 'mute') voice.muted = !voice.muted; else voice.deafened = !voice.deafened;
  localStorage.setItem('voiceMuted', String(voice.muted));
  localStorage.setItem('voiceDeafened', String(voice.deafened));
  applyMute(); paintControls();
  if (voice.enabled && socket?.connected) void requestServer('set-voice-state', { enabled: true, muted: voice.muted }).catch(announce);
  if (voice.muted && voice.deafened && !window.channelAccompaniment?.active()) await stopVoice({ keepTest: true });
  else { attemptedChannel = null; syncVoice(); }
}
function fillMicrophones(select, devices = microphoneDevices) {
  select.replaceChildren(new Option('系统默认麦克风', 'default'));
  for (const device of devices.filter(d => d.id && d.id !== 'default')) select.add(new Option(device.name || '麦克风', device.id));
  if (![...select.options].some(option => option.value === microphone())) select.add(new Option('已保存的麦克风（当前不可用）', microphone()));
  select.value = microphone();
}
async function changeMicrophone(deviceId) {
  if (changingMicrophone || voice.busy || testBusy || !deviceId || deviceId === microphone()) { paintControls(); return; }
  const previous = microphone(), resumeTest = voice.testing, hadCapture = !!rawStream, ownerRoom = state.roomId;
  changingMicrophone = true; paintControls();
  const replaceCapture = async () => {
    const token = ++generation; cancelCaptureWait?.();
    if (capturePending) await capturePending.catch(() => {});
    localMeter?.(); localMeter = null;
    source?.disconnect(); micGain?.disconnect(); source = micGain = null; rawStream = null;
    captureAudio?.pause(); if (captureAudio) { captureAudio.srcObject = null; captureAudio.remove(); } captureAudio = null;
    bridge?.close(); bridge = null;
    await window.electronAPI.voiceStop();
    if (token !== generation || state.leaving || state.roomId !== ownerRoom) throw new Error('麦克风切换已取消');
    await ensureCapture();
  };
  try {
    if (resumeTest) await stopMicrophoneTest({ keepCapture: true });
    localStorage.setItem('voiceMicrophone', deviceId);
    if (hadCapture) await replaceCapture();
    if (resumeTest && !$('#settingsModal').classList.contains('hidden')) await startMicrophoneTest();
  } catch (error) {
    localStorage.setItem('voiceMicrophone', previous);
    if (state.leaving || state.roomId !== ownerRoom) return;
    announce(error);
    try { if (hadCapture) await replaceCapture(); if (resumeTest) await startMicrophoneTest(); }
    catch (restoreError) { announce(restoreError); await stopVoice(); }
  } finally { changingMicrophone = false; paintControls(); syncVoice(); }
}
export function decorateVoiceCard(card, user, isMe) {
  card.dataset.userId = user.socketId; card.classList.toggle('is-speaking', !!levels.get(user.socketId));
  const row = document.createElement('div'); row.className = 'card-voice-row'; card.append(row);
  if (isMe) {
    const wrap = document.createElement('div'); wrap.className = 'microphone-control'; row.append(wrap);
    const mic = document.createElement('button'); mic.type = 'button'; mic.className = 'voice-control'; mic.dataset.voice = 'mute'; mic.onclick = () => void changeVoicePreference('mute'); wrap.append(mic);
    const panel = document.createElement('div'); panel.className = 'microphone-popover'; panel.setAttribute('aria-label', '麦克风设置');
    const label = document.createElement('label'); label.textContent = '麦克风音量';
    const gain = document.createElement('input'); gain.type = 'range'; gain.min = 0; gain.max = 100; gain.value = microphoneVolume * 100; gain.setAttribute('aria-label', '麦克风音量');
    gain.oninput = () => { microphoneVolume = Number(gain.value) / 100; localStorage.setItem('voiceMicVolume', String(microphoneVolume)); applyMute(); }; label.append(gain); panel.append(label);
    const deviceLabel = document.createElement('label'); deviceLabel.textContent = '麦克风';
    const select = document.createElement('select'); select.dataset.microphoneSelect = 'true'; select.setAttribute('aria-label', '选择麦克风'); fillMicrophones(select); deviceLabel.append(select); panel.append(deviceLabel);
    let loaded = false;
    const load = async () => { if (loaded) return; loaded = true; try { microphoneDevices = await window.electronAPI.voiceDevices(); fillMicrophones(select); paintControls(); } catch (error) { loaded = false; announce(error); } };
    wrap.addEventListener('mouseenter', load); wrap.addEventListener('focusin', load);
    select.onchange = () => void changeMicrophone(select.value);
    const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'microphone-settings-link'; settings.textContent = '语音设置'; settings.onclick = () => { $('#btnSettings').click(); void refreshVoiceDevices(); }; panel.append(settings); wrap.append(panel);
    const status = document.createElement('span'); status.className = 'voice-status'; row.append(status);
    const headphones = document.createElement('button'); headphones.type = 'button'; headphones.className = 'voice-control'; headphones.dataset.voice = 'deafen'; headphones.onclick = () => void changeVoicePreference('deafen'); row.append(headphones);
    window.channelAccompaniment?.decorate(card);
  } else {
    card.classList.add('remote-user-card');
    const footer = document.createElement('div'); footer.className = 'remote-card-footer';
    footer.append(card.querySelector('.name'), row); card.append(footer); row.className = 'remote-card-actions';
    if (user.voiceMuted || user.microphoneMuted || !user.voiceEnabled) {
      const muted = document.createElement('span'); muted.className = 'remote-mic-muted'; muted.innerHTML = voiceIcon('mute', true);
      muted.title = user.voiceMuted ? '已被禁言' : '麦克风已关闭'; muted.setAttribute('aria-label', muted.title); row.append(muted);
    }
    const control = document.createElement('div'); control.className = 'speaker-control'; row.append(control);
    const speakerButton = document.createElement('button'); speakerButton.type = 'button'; speakerButton.className = 'remote-speaker-button'; speakerButton.title = '调整语音音量'; speakerButton.setAttribute('aria-label', `调整${user.name}的语音音量`);
    speakerButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4L6 8H3v8h3l5 4V4Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>'; control.append(speakerButton);
    const label = document.createElement('label'); label.className = 'voice-volume speaker-popover';
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.value = String((volumes.get(user.socketId) ?? 1) * 100); input.setAttribute('aria-label', `${user.name}的音量`);
    input.oninput = () => { volumes.set(user.socketId, Number(input.value) / 100); applyMute(); }; label.append(input); control.append(label);
  }
  paintControls();
}
function paintControls() {
  for (const button of document.querySelectorAll('[data-voice]')) {
    const mode = button.dataset.voice, me = state.serverUsers.find(u => u.socketId === socket?.id);
    const active = mode === 'join' ? voice.enabled : mode === 'mute' ? voice.muted || me?.voiceMuted : voice.deafened;
    button.classList.toggle('active', !!active); button.setAttribute('aria-pressed', String(!!active));
    button.disabled = voice.busy || changingMicrophone || (mode === 'mute' && !!me?.voiceMuted);
    button.innerHTML = voiceIcon(mode, !!active);
    button.title = mode === 'join' ? voice.busy ? '正在连接语音' : voice.enabled ? '退出频道语音' : '加入频道语音' : mode === 'mute' ? me?.voiceMuted ? '已被管理员禁言' : voice.muted ? '取消麦克风静音' : '麦克风静音' : voice.deafened ? '恢复收听' : '关闭收听';
    button.setAttribute('aria-label', button.title);
  }
  for (const status of document.querySelectorAll('.voice-status')) status.textContent = voice.busy ? '连接中…' : state.serverUsers.find(u => u.socketId === socket?.id)?.voiceMuted ? '已被禁言' : voice.muted ? '麦克风已关闭' : '自由发言';
  if ($('#btnMicrophoneTest')) { $('#btnMicrophoneTest').textContent = testBusy ? '正在启动…' : voice.testing ? '停止测试' : '测试麦克风'; $('#btnMicrophoneTest').disabled = voice.busy || !!cleanup || testBusy || !!testCleanup || changingMicrophone; }
  for (const select of document.querySelectorAll('[data-microphone-select], #voiceMicrophone')) {
    if (![...select.options].some(option => option.value === microphone())) {
      const device = microphoneDevices.find(d => d.id === microphone());
      select.add(new Option(device?.name || '当前麦克风', microphone()));
    }
    select.value = microphone(); select.disabled = changingMicrophone || voice.busy || testBusy || !!cleanup || !!testCleanup;
  }
  if ($('#voiceSpeaker')) $('#voiceSpeaker').disabled = voice.busy || voice.testing || voice.enabled || testBusy || changingMicrophone;
}
export async function refreshVoiceDevices() {
  const mic = $('#voiceMicrophone'), output = $('#voiceSpeaker');
  try {
    microphoneDevices = await window.electronAPI.voiceDevices();
    for (const select of document.querySelectorAll('[data-microphone-select], #voiceMicrophone')) fillMicrophones(select);
    const outputs = await navigator.mediaDevices.enumerateDevices(); output.replaceChildren(new Option('系统默认扬声器', 'default'));
    for (const [index, d] of outputs.filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default').entries()) output.add(new Option(d.label || `扬声器 ${index + 1}`, d.deviceId));
    if (![...output.options].some(o => o.value === speaker())) output.add(new Option('已保存的扬声器（当前不可用）', speaker()));
    output.value = speaker();
    paintControls();
  } catch (error) { announce(error); }
}
export function initVoice() {
  window.channelVoice = { accompanimentState: async active => {
    if (voice.enabled && socket?.connected) {
      await requestServer('set-voice-state', { enabled: true, muted: voice.muted, accompaniment: active });
      announcedSpeaking = null;
    }
  }, sync: syncVoice, stop: stopVoice, receive: receiveVoice, activity: receiveVoiceActivity, decorate: decorateVoiceCard, isEnabled: () => voice.enabled, mix: mixAccompaniment, stopIfIdle: () => voice.muted && voice.deafened ? stopVoice({ keepTest: true }) : Promise.resolve() };
  $('#btnVoiceDevices').onclick = refreshVoiceDevices;
  $('#voiceMicrophone').onchange = event => void changeMicrophone(event.target.value);
  $('#voiceSpeaker').onchange = event => localStorage.setItem('voiceSpeaker', event.target.value);
  $('#btnMicrophoneTest').onclick = () => voice.testing ? stopMicrophoneTest() : startMicrophoneTest();
  $('#btnCloseSettings').addEventListener('click', () => { if (voice.testing || testBusy) void stopMicrophoneTest(); });
  $('#settingsModal').addEventListener('click', event => { if (event.target === $('#settingsModal') && (voice.testing || testBusy)) void stopMicrophoneTest(); });
}
async function mixAccompaniment(stream, volume) {
  for (let i = 0; voice.busy && i < 300; i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!voice.enabled) await startVoice();
  if (!voice.enabled || !context || !voiceDestination || state.leaving) throw new Error('请先连接频道语音');
  const input = context.createMediaStreamSource(stream), gain = context.createGain();
  gain.gain.value = volume; input.connect(gain); gain.connect(voiceDestination);
  return { volume: value => { gain.gain.value = value; }, dispose: () => { input.disconnect(); gain.disconnect(); } };
}
