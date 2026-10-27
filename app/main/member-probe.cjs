const dgram=require('node:dgram');
const {isIPv4}=require('node:net');
const {randomBytes}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const PORT=31113, MAGIC=Buffer.from('SSRTT001');
const validIp=ip=>typeof ip==='string'&&isIPv4(ip)&&ip.startsWith('10.144.');

// A small UDP echo endpoint is reachable through both TUN and EasyTier's
// userspace UDP forwarding. Nonces and connected sockets reject stale replies.
function createMemberProbe({getContext,forwarder,port=PORT,timeout=1500,bindHost}) {
  let endpoint,context,sweep,closed=true,tokens=200,refill=Date.now();
  const scopes=new Map(),pending=new Map(),cache=new Map(),cancel=new Set();
  const empty=ip=>({ip,rttMs:null,noTun:true,source:'probe'});
  async function release(ip,entry) { if(scopes.get(ip)===entry)scopes.delete(ip);await forwarder.close(entry.id).catch(()=>{}); }
  async function stop() {
    closed=true;context=null;clearInterval(sweep);cache.clear();
    for(const finish of cancel)finish();
    const socket=endpoint;endpoint=null;if(socket)try{socket.close();}catch{}
    await Promise.allSettled([...scopes].map(([ip,entry])=>release(ip,entry)));
    await Promise.allSettled([...pending.values()]);pending.clear();
  }
  async function start() {
    await stop();const current=getContext();if(!current)return;
    context=current;closed=false;const socket=endpoint=dgram.createSocket('udp4');
    socket.on('message',(bytes,remote)=>{
      if(closed||getContext()!==current||bytes.length!==25||!bytes.subarray(0,8).equals(MAGIC)||bytes[8]!==1)return;
      if(current.noTun?remote.address!=='127.0.0.1':!validIp(remote.address))return;
      const now=Date.now();tokens=Math.min(200,tokens+(now-refill)/5);refill=now;if(tokens<1)return;tokens--;
      const reply=Buffer.from(bytes);reply[8]=2;socket.send(reply,remote.port,remote.address,()=>{});
    });
    await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(port,bindHost||(current.noTun?'127.0.0.1':current.virtualIp),resolve);}).catch(async error=>{await stop();throw error;});
    if(closed||context!==current||getContext()!==current){try{socket.close();}catch{}return;}
    socket.on('error',()=>{});
    sweep=setInterval(()=>{for(const [ip,entry] of scopes)if(!pending.has(ip)&&Date.now()-entry.touched>15000)void release(ip,entry);},5000);sweep.unref?.();
  }
  async function target(ip,current) {
    let entry=scopes.get(ip);
    if(!entry){
      if(scopes.size>=128){const oldest=[...scopes].filter(([key])=>!pending.has(key)).sort((a,b)=>a[1].touched-b[1].touched)[0];if(!oldest)throw Error('网络检测繁忙');await release(...oldest);}
      const scope=forwarder.open(ip);entry={id:scope.id,touched:Date.now()};scopes.set(ip,entry);
      entry.target=forwarder.forward(scope.id,'udp',port,false).catch(async error=>{await release(ip,entry);throw error;});
    }
    entry.touched=Date.now();const result=await entry.target;
    if(closed||getContext()!==current||context!==current)throw Error('虚拟网络已断开');return result;
  }
  function measure(ip,target,current) {
    return new Promise(resolve=>{
      const socket=dgram.createSocket('udp4'),packet=Buffer.concat([MAGIC,Buffer.from([1]),randomBytes(16)]);let timer,done=false,started;
      const finish=rttMs=>{if(done)return;done=true;clearTimeout(timer);cancel.delete(finish);try{socket.close();}catch{}resolve({...empty(ip),rttMs:closed||getContext()!==current?null:rttMs??null});};
      cancel.add(finish);timer=setTimeout(()=>finish(),timeout);
      socket.on('error',()=>finish());
      socket.on('message',bytes=>{if(bytes.length===25&&bytes.subarray(0,8).equals(MAGIC)&&bytes[8]===2&&bytes.subarray(9).equals(packet.subarray(9)))finish(Math.max(0.1,performance.now()-started));});
      socket.connect(target.port,target.host,()=>{if(done)return;started=performance.now();socket.send(packet,error=>{if(error)finish();});});
    });
  }
  function ping(ip) {
    if(!validIp(ip))return Promise.reject(Error('无效的成员虚拟 IP'));
    const current=getContext();if(closed||!current||context!==current)return Promise.resolve(empty(ip));
    const saved=cache.get(ip);if(saved&&Date.now()-saved.time<2500)return Promise.resolve(saved.result);
    if(pending.has(ip))return pending.get(ip);if(pending.size>=6)return Promise.resolve(empty(ip));
    const task=(async()=>{try{return await measure(ip,await target(ip,current),current);}catch{return empty(ip);}})().then(result=>{if(!closed&&context===current){cache.set(ip,{time:Date.now(),result});if(cache.size>128)cache.delete(cache.keys().next().value);}return result;}).finally(()=>{if(pending.get(ip)===task)pending.delete(ip);});
    pending.set(ip,task);return task;
  }
  return {start,stop,ping};
}
module.exports={createMemberProbe,PORT};
