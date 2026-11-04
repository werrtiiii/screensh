import { allowOpusStereo } from './voice-encoding.mjs';
export class WhepSession {
  constructor(url, configuration, onTrack, onFailure, options = {}) {
    this.url = url; this.controller = new AbortController(); this.closed = false;
    this.audioOnly = options.audioOnly === true;
    this.directRelay = options.directRelay === true;
    this.videoStartupTimeoutMs=options.videoStartupTimeoutMs??10000;
    this.stereo = options.stereo === true;
    this.getToken=options.getToken;this.headers={};
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
      if (this.pc.connectionState === 'failed' && !this.closed) onFailure(new Error(this.directRelay?'媒体连接失败，请检查 MediaMTX 的媒体端口、防火墙和公网候选地址':'媒体连接失败，请检查共享端网络和 UDP 8189'));
    };
    this.onFailure = onFailure;
  }
  async start() {
    const pc = this.pc, signal = this.controller.signal;
    if(this.getToken){this.headers={Authorization:'Bearer '+await this.getToken()};if(signal.aborted)throw Error('观看已取消');}
    if(this.tunnel){const target=await this.tunnel.http(Number(new URL(this.url).port)||8889);if(this.closed)throw Error('观看已取消');const url=new URL(this.url);url.hostname=target.host;url.port=target.port;this.url=url.href;}
    this.connectTimer = setTimeout(() => {
      if (!this.closed) this.onFailure(new Error(this.directRelay?`无法连接转发服务器 ${new URL(this.url).host}：请检查 MediaMTX 地址、媒体端口映射及防火墙`:`无法连接共享端 ${new URL(this.url).host}：请检查双方 EasyTier 节点、虚拟网卡路由及共享端防火墙（TCP 8889、UDP/TCP 8189）`));
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
      method: 'POST', headers: { ...this.headers,'Content-Type': 'application/sdp' }, body: localOffer.sdp, signal,redirect:'error',
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
    this.answered = true; this.flushCandidates();this.watchVideoStart();
  }
  watchVideoStart() {
    if(this.audioOnly||typeof this.pc.getStats!=='function')return;
    let connectedAt=null,pending=false;
    this.videoStartTimer=setInterval(async()=>{
      if(this.closed||pending)return;
      if(this.pc.connectionState!=='connected'){connectedAt=null;return;}
      connectedAt??=Date.now();pending=true;
      try{
        const report=await this.pc.getStats();if(this.closed)return;
        const videos=[...report.values()].filter(row=>row.type==='inbound-rtp'&&row.kind==='video');
        if(videos.some(row=>row.framesDecoded>0)){clearInterval(this.videoStartTimer);return;}
        if(Date.now()-connectedAt>=this.videoStartupTimeoutMs){
          clearInterval(this.videoStartTimer);
          this.onFailure(new Error(videos.some(row=>row.bytesReceived>0)?'已收到视频数据但未能解码，重新连接视频以请求关键帧':'媒体已连接但未收到可播放的视频帧'));
        }
      }catch{}finally{pending=false;}
    },1000);
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
        method: 'PATCH', headers: { ...this.headers,'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*' },
        body, signal: this.controller.signal,redirect:'error',
      });
      if (!response.ok) throw new Error(`ICE 候选地址发送失败: ${response.status}`);
    }).catch(error => { if (!this.closed) this.onFailure(error); });
  }
  deleteResource() {
    if (!this.resource) return Promise.resolve();
    const url = this.resource; this.resource = null;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
    return fetch(url, { method: 'DELETE', headers:this.headers,keepalive: true,redirect:'error',signal:controller.signal })
      .catch(() => {}).finally(()=>clearTimeout(timer));
  }
  close() {
    if(this.closing)return this.closing;
    this.closed = true; clearTimeout(this.connectTimer);clearInterval(this.videoStartTimer);
    this.controller.abort(); this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.onconnectionstatechange = null;
    this.pc.close();
    // Keep no-TUN HTTP forwarding alive until MediaMTX receives the DELETE.
    this.closing=this.deleteResource().finally(()=>this.tunnel?.close()).catch(()=>{});
    return this.closing;
  }
}
