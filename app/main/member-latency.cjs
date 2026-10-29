const {isIPv4}=require('node:net');

// Prefer the same end-to-end measurement in both adapter modes. ICMP is only
// a compatibility fallback; a peer without a TUN adapter may not answer it.
function createMemberLatency({getContext,probe,pinger,routes}) {
  const valid=(result,ip)=>result?.ip===ip&&Number.isFinite(result.rttMs)&&result.rttMs>=0;
  return {async ping(ip) {
    if(typeof ip!=='string'||!isIPv4(ip)||!ip.startsWith('10.144.'))throw Error('无效的成员虚拟 IP');
    const context=getContext();
    const empty=()=>({ip,rttMs:null,noTun:!!context?.noTun,source:'unavailable'});
    if(!context)return empty();
    const current=()=>getContext()===context;
    try {
      const result=await probe.ping(ip);
      if(!current())return empty();
      if(valid(result,ip))return {...result,noTun:!!context.noTun,source:'probe'};
    } catch {}
    if(!current())return empty();
    if(!context.noTun) {
      try {
        const result=await pinger.ping(ip);
        if(!current())return empty();
        if(valid(result,ip))return {...result,noTun:false,source:'icmp'};
      } catch {}
    }
    if(!current())return empty();
    try {
      const result=await routes.read();
      if(!current())return empty();
      const row=result?.available&&result.rows.find(row=>row.ip===ip&&row.route==='p2p');
      if(Number.isFinite(row?.rttMs)&&row.rttMs>0)return {ip,rttMs:row.rttMs,noTun:!!context.noTun,source:'tunnel'};
    } catch {}
    return empty();
  }};
}
module.exports={createMemberLatency};
