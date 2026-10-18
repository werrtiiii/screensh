const { test } = require('node:test');
const assert = require('node:assert/strict');

test('accompaniment WHEP negotiates stereo before local decoding and sends the same offer', async t => {
  const { WhepSession } = await import('../renderer/whep.mjs');
  const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';
  class Peer {
    addTransceiver() {}
    async createOffer() { return {type:'offer',sdp}; }
    async setLocalDescription(offer) { this.localDescription=offer; }
    async setRemoteDescription() {}
    close() {}
  }
  const original=globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection=Peer;
  t.after(()=>{if(original)globalThis.RTCPeerConnection=original;else delete globalThis.RTCPeerConnection;});
  let posted;
  t.mock.method(globalThis,'fetch',async (_url,init)=>{
    if(init.method==='POST')posted=init.body;
    return {ok:true,headers:new Headers({Location:'/session'}),text:async()=>'answer'};
  });
  const session=new WhepSession('http://127.0.0.1:8891/live/whep',{},()=>{},()=>{},{audioOnly:true,stereo:true});
  t.after(()=>session.close());await session.start();
  assert.match(session.pc.localDescription.sdp,/;stereo=1;sprop-stereo=1;maxaveragebitrate=128000/);
  assert.equal(posted,session.pc.localDescription.sdp);
});

test('WHEP sends queued ICE using PATCH, deletes session and cancels pending starts', async t => {
  const { WhepSession } = await import('../renderer/whep.mjs');
  class Peer extends EventTarget {
    constructor() { super(); this.iceGatheringState = 'new'; }
    addTransceiver() {}
    createDataChannel() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:test\r\na=ice-pwd:password\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n' }; }
    async setLocalDescription(offer) {
      this.localDescription = offer;
      this.onicecandidate?.({ candidate: { sdpMLineIndex: 0, candidate: 'candidate:1 1 udp 123 10.0.0.1 5000 typ host' } });
    }
    async setRemoteDescription(answer) { this.answer = answer; }
    close() { this.closed = true; }
  }
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return { ok: true, headers: new Headers({ Location: '/live/whep/session-1' }), text: async () => 'answer' };
  });
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = Peer;
  t.after(() => { if (original) globalThis.RTCPeerConnection = original; else delete globalThis.RTCPeerConnection; });
  const session = new WhepSession('http://127.0.0.1:8889/live/whep', {}, () => {}, () => {});
  await session.start();
  await session.patchChain;
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.match(calls[1].init.body, /a=ice-ufrag:test/);
  assert.match(calls[1].init.body, /a=mid:0/);
  assert.match(calls[1].init.body, /a=candidate:1/);
  session.close();
  assert.equal(session.pc.closed, true);
  assert.equal(calls[2].init.method, 'DELETE');
  assert.equal(calls[2].url, 'http://127.0.0.1:8889/live/whep/session-1');
  const cancelled = new WhepSession('http://127.0.0.1:8889/live/whep', {}, () => {}, () => {});
  const pending = cancelled.start(); cancelled.close();
  await assert.rejects(pending, /取消/);
  assert.equal(calls.length, 3);
});
