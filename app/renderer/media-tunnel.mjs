// Convert only authenticated members' virtual-address ICE candidates. Local
// physical addresses never leave the machine in no-TUN mode.
export function createMediaTunnel(ip,noTun,api=window.electronAPI){
  let closed=false,closing;const ready=noTun?api.openTunnelScope(ip):Promise.resolve(null);
  void ready.catch(()=>{});
  function parse(value){const parts=value?.split(' ');return parts?.length>=8?parts:null;}
  async function localCandidate(candidate,virtualIp){
    const parts=parse(candidate.candidate);if(!parts)return null;
    if(!noTun)return parts[4]===virtualIp?candidate:null;
    if(parts[2].toLowerCase()!=='udp'||parts[7]!=='host'||!/^\d+\.\d+\.\d+\.\d+$/.test(parts[4])||parts[4].startsWith('169.254.'))return null;
    const scope=await ready;if(closed)return null;const exposed=await api.exposeTunnelPort(scope.id,parts[4],Number(parts[5]));if(closed)return null;parts[4]=virtualIp;parts[5]=String(exposed.port);return {...candidate,candidate:parts.join(' ')};
  }
  async function remoteCandidate(candidate){const parts=parse(candidate.candidate);if(!parts||parts[4]!==ip)return null;if(!noTun)return candidate;if(parts[2].toLowerCase()!=='udp')return null;
    const scope=await ready;if(closed)return null;const target=await api.forwardTunnelPort(scope.id,'udp',Number(parts[5]));if(closed)return null;parts[4]=target.host;parts[5]=String(target.port);return {...candidate,candidate:parts.join(' ')};
  }
  async function description(description,convert){const lines=[];for(const line of description.sdp.split('\r\n')){if(!line.startsWith('a=candidate:')){lines.push(line);continue;}const candidate=await convert({candidate:line.slice(2)});if(candidate)lines.push('a='+candidate.candidate);}return {type:description.type,sdp:lines.join('\r\n')};}
  return {localCandidate,remoteCandidate,localDescription:(value,vip)=>description(value,c=>localCandidate(c,vip)),remoteDescription:value=>description(value,remoteCandidate),
    async http(port){if(!noTun)return {host:ip,port};const scope=await ready;if(closed)throw Error('媒体会话已关闭');return api.forwardTunnelPort(scope.id,'tcp',port);},
    close(){closed=true;return closing||=(ready.then(scope=>scope&&api.closeTunnelScope(scope.id)).catch(()=>{}));}};
}
