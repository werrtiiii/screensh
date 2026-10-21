import { allowOpusStereo } from './voice-encoding.mjs';
export class WhepSession {
  constructor(url, configuration, onTrack, onFailure, options = {}) {
    this.url = url; this.controller = new AbortController(); this.closed = false;
    this.audioOnly = options.audioOnly === true;
    this.stereo = options.stereo === true;
    this.tunnel=options.tunnel;this.virtualIp=options.virtualIp;
    this.candidates = []; this.patchChain = Promise.resolve();
    this.pc = new RTCPeerConnection({ ...configuration, bundlePolicy: 'max-bundle' });
    this.pc.ontrack = onTrack;
    this.pc.onicecandidate = event => {
      if (this.closed || !event.candidate) return;
      this.candidates.push(event.candidate);
      if (this.answered) this.flushCandidates();
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'connected') clearTimeout(this.connectTimer);
      if (this.pc.connectionState === 'failed' && !this.closed) onFailure(new Error('媒体连接失败，请检查共享端网络和 UDP 8189'));
    };
    this.onFailure = onFailure;
  }
  async start() {
    const pc = this.pc, signal = this.controller.signal;
    if(this.tunnel){const target=await this.tunnel.http(Number(new URL(this.url).port)||8889);if(this.closed)throw Error('观看已取消');const url=new URL(this.url);url.hostname=target.host;url.port=target.port;this.url=url.href;}
    this.connectTimer = setTimeout(() => {
      if (!this.closed) this.onFailure(new Error(`无法连接共享端 ${new URL(this.url).host}：请检查双方 EasyTier 节点、虚拟网卡路由及共享端防火墙（TCP 8889、UDP/TCP 8189）`));
    }, 20000);
    if (!this.audioOnly) pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    if (this.stereo) offer.sdp = allowOpusStereo(offer.sdp, 128000);
    await pc.setLocalDescription(offer);
    if (signal.aborted) throw new Error('观看已取消');
    this.offer = offer.sdp;
    // Send the offer immediately, then deliver gathered candidates using WHEP PATCH.
    const localOffer=this.tunnel?await this.tunnel.localDescription(offer,this.virtualIp):offer;
    const response = await fetch(this.url, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: localOffer.sdp, signal,
    });
    if (!response.ok) throw new Error(`MediaMTX 响应失败: ${response.status}`);
    const location = response.headers.get('Location');
    if (!location) throw new Error('MediaMTX 未返回会话地址');
    const resource = new URL(location, this.url);
    if (resource.origin !== new URL(this.url).origin) throw new Error('无效的 WHEP 会话地址');
    this.resource = resource.href;
    if (this.closed) { this.deleteResource(); throw new Error('观看已取消'); }
    const sdp = await response.text();
    if (this.closed) throw new Error('观看已取消');
    await pc.setRemoteDescription(this.tunnel?await this.tunnel.remoteDescription({type:'answer',sdp}):{ type: 'answer', sdp });
    this.answered = true; this.flushCandidates();
  }
  flushCandidates() {
    if (!this.candidates.length || this.closed) return;
    const rawCandidates = this.candidates.splice(0);
    const lines = this.offer.split('\r\n');
    const credentials = lines.filter(line => line.startsWith('a=ice-ufrag:') || line.startsWith('a=ice-pwd:'));
    const sections = this.offer.split('\r\nm=');
    this.patchChain = this.patchChain.then(async () => {
    if(this.closed)return;
    const candidates=this.tunnel?(await Promise.all(rawCandidates.map(candidate=>this.tunnel.localCandidate(candidate.toJSON?candidate.toJSON():candidate,this.virtualIp)))).filter(Boolean):rawCandidates;
    if(!candidates.length)return;
    let body = [...new Set(credentials)].join('\r\n') + '\r\n';
    sections.slice(1).forEach((section, index) => {
      const group = candidates.filter(candidate => candidate.sdpMLineIndex === index);
      if (!group.length) return;
      const mid = section.split('\r\n').find(line => line.startsWith('a=mid:'));
      body += `m=${section.split('\r\n')[0]}\r\n${mid}\r\n`;
      for (const candidate of group) body += `a=${candidate.candidate}\r\n`;
    });
      if (this.closed) return;
      const response = await fetch(this.resource, {
        method: 'PATCH', headers: { 'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*' },
        body, signal: this.controller.signal,
      });
      if (!response.ok) throw new Error(`ICE 候选地址发送失败: ${response.status}`);
    }).catch(error => { if (!this.closed) this.onFailure(error); });
  }
  deleteResource() {
    if (!this.resource) return;
    const url = this.resource; this.resource = null;
    fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
  close() {
    this.closed = true; clearTimeout(this.connectTimer);
    this.controller.abort(); this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.onconnectionstatechange = null;
    this.pc.close(); this.deleteResource();
    this.tunnel?.close();
  }
}
