import {createMediaTunnel} from '../../renderer/media-tunnel.mjs';
import {WhepSession} from '../../renderer/whep.mjs';
const ips=['10.144.242.1','10.144.242.2','10.144.242.3'];
const mode=side=>window.testModes?.[side]??true;
const api=side=>Object.fromEntries(['openTunnelScope','forwardTunnelPort','exposeTunnelPort','closeTunnelScope'].map(key=>[key,(...args)=>window.network[key](side,...args)]));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function gather(pc){while(pc.iceGatheringState!=='complete')await sleep(20);}
window.voiceNoTunProbe=async()=>{
  const context=new AudioContext(),oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();await context.resume();const pcs=[],tunnels=[];
  try{const results=[];for(const [aSide,bSide] of window.testPairs||[[0,1],[0,2],[1,2]]){
    const a=new RTCPeerConnection(),b=new RTCPeerConnection();pcs.push(a,b);const aTunnel=createMediaTunnel(ips[bSide],mode(aSide),api(aSide)),bTunnel=createMediaTunnel(ips[aSide],mode(bSide),api(bSide));tunnels.push(aTunnel,bTunnel);
    const analysers=[];for(const pc of [a,b]){pc.addTrack(destination.stream.getAudioTracks()[0],destination.stream);pc.ontrack=event=>{const analyser=context.createAnalyser(),source=context.createMediaStreamSource(new MediaStream([event.track])),gain=context.createGain();gain.gain.value=0;source.connect(analyser);analyser.connect(gain);gain.connect(context.destination);analysers.push(analyser);const audio=document.createElement('audio');audio.muted=true;audio.srcObject=new MediaStream([event.track]);document.body.append(audio);void audio.play();};}
    await a.setLocalDescription(await a.createOffer());await gather(a);await b.setRemoteDescription(await bTunnel.remoteDescription(await aTunnel.localDescription(a.localDescription,ips[aSide])));
    await b.setLocalDescription(await b.createAnswer());await gather(b);await a.setRemoteDescription(await aTunnel.remoteDescription(await bTunnel.localDescription(b.localDescription,ips[bSide])));
    const until=Date.now()+20000;let packets=[],energy=[];const received=()=>packets.length===2&&packets.every(value=>value>10)&&energy.length===2&&energy.every(value=>value>0);
    while(Date.now()<until){packets=await Promise.all([a,b].map(async pc=>[...(await pc.getStats()).values()].find(row=>row.type==='inbound-rtp'&&row.kind==='audio')?.packetsReceived||0));energy=analysers.map(analyser=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);return values.reduce((sum,value)=>sum+value*value,0)/values.length;});if(a.connectionState==='connected'&&b.connectionState==='connected'&&received())break;await sleep(100);}
    if(a.connectionState!=='connected'||b.connectionState!=='connected'||!received())throw Error('No TUN voice failed '+JSON.stringify({a:a.connectionState,b:b.connectionState,packets,energy,context:context.state}));results.push({peers:[aSide,bSide],packets,energy});
  }return results;}finally{pcs.forEach(pc=>pc.close());await Promise.all(tunnels.map(tunnel=>tunnel.close()));oscillator.stop();await context.close();document.querySelectorAll('audio').forEach(audio=>audio.remove());}
};
window.watchNoTunProbe=async(httpPort,self=false,publisher=1,viewer=0)=>{
  const side=self?publisher:viewer,video=document.createElement('video');video.muted=true;video.autoplay=true;document.body.append(video);const session=new WhepSession(`http://${ips[publisher]}:${httpPort}/live/whep`,{},event=>{video.srcObject ||= new MediaStream();video.srcObject.addTrack(event.track);void video.play();},error=>console.error(error),mode(side)?{tunnel:createMediaTunnel(ips[publisher],true,api(side)),virtualIp:ips[side]}:{});
  try{await session.start();const until=Date.now()+20000;while(Date.now()<until){const report=await session.pc.getStats(),stats=[...report.values()].find(row=>row.type==='inbound-rtp'&&row.kind==='video');if(video.videoWidth>0&&stats?.framesDecoded>2)return {width:video.videoWidth,height:video.videoHeight,frames:stats.framesDecoded,self};await sleep(100);}throw Error('No TUN WHEP did not decode');}finally{session.close();video.remove();}
};
