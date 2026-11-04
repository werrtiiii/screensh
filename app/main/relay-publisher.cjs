const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {isIPv4}=require('node:net');
const {isPrivateVirtualIp}=require('./virtual-address.cjs');
function validateRelay(value){
  if(!value||!/^relay-[a-f0-9-]{36}$/.test(value.path)||typeof value.token!=='string'||value.token.length<40||value.token.length>2048||/[\r\n]/.test(value.token))throw Error('服务器转发地址或凭证无效');
  if(value.transport==='direct'){
    let url;try{url=new URL(value.url);}catch{throw Error('服务器直连转发地址无效');}
    if(!['http:','https:'].includes(url.protocol)||url.origin!==value.url||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.hostname!==value.host||Number(url.port||(url.protocol==='https:'?443:80))!==value.port)throw Error('服务器直连转发地址无效');
  }else if(value.transport&&value.transport!=='easytier'||!isPrivateVirtualIp(value.host)||!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw Error('服务器转发地址或凭证无效');
  return value;
}
async function createRelayPublisher({relay,noTun,virtualIp,forwarder,pacerExe,onFailure=()=>{},onDiagnostics=detail=>console.info('[Relay Publisher]',JSON.stringify(detail)),createPacer=require('./media-udp-pacer.cjs').createMediaUdpPacer}){
  validateRelay(relay);let closed=false;const controllers=new Set(),prefix='/'+randomUUID();
  const direct=relay.transport==='direct',scope=direct?null:forwarder.open(relay.host);
  const closeScope=()=>scope?forwarder.close(scope.id):Promise.resolve();
  let server,closing,scopeClosing;const pacers=new Map();
  async function pacedPort(host,port,mode){
    const key=mode+':'+host+':'+port;
    if(!pacers.has(key)){
      const pacer=createPacer({port:0,targetPort:port,targetHost:host,mode,onFailure,...(pacerExe?{exe:pacerExe}:{})});
      const entry={pacer};pacers.set(key,entry);entry.ready=pacer.start().then(port=>{if(closed)throw Error('共享已取消');return port;});
    }
    return pacers.get(key).ready;
  }
  function cancel(){if(closing)return closing;closed=true;for(const controller of controllers)controller.abort();server.closeAllConnections?.();closing=new Promise(resolve=>server.close(resolve));return closing;}
  async function sdp(value,remote){
    // Public/LAN direct mode uses native ICE connectivity and never maps
    // candidates through EasyTier, even when the client itself has no TUN.
    if(direct)return value;
    const lines=[];let candidates=0,mapped=0;
    for(const line of value.split('\r\n')){
      if(!line.startsWith('a=candidate:')){lines.push(line);continue;}
      candidates++;
      const parts=line.slice(2).split(' ');
      if(parts.length<8)continue;
      if(remote){
        if(parts[4]!==relay.host)continue;
        if(parts[2].toLowerCase()==='udp'){
          // OBS emits keyframes in bursts. Pace before entering EasyTier's
          // UDP proxy (or the TUN route), not only after receiving a stream.
          const target=await forwarder.forward(scope.id,'udp',Number(parts[5]),false);parts[4]='127.0.0.1';
          if(target.host!=='127.0.0.1'&&target.host!==relay.host)throw Error('无效的本机转发地址');
          parts[5]=String(await pacedPort(target.host,target.port,'publish'));
        }else if(noTun)continue;
      }else if(noTun){
        if(parts[2].toLowerCase()!=='udp'||parts[7]!=='host'||!isIPv4(parts[4])||parts[4].startsWith('169.254.'))continue;
        // MediaMTX may nominate this advertised candidate instead of the
        // answer-side proxy. Pace OBS replies on this route too, or it bypasses
        // the publisher pacer and injects keyframe bursts into EasyTier.
        const port=await pacedPort(parts[4],Number(parts[5]),'receive');
        const target=await forwarder.expose(scope.id,'127.0.0.1',port);parts[4]=virtualIp;parts[5]=String(target.port);
      }
      lines.push('a='+parts.join(' '));
      mapped++;
    }
    onDiagnostics({stage:remote?'answer':'offer',candidates,mapped,noTun});
    return lines.join('\r\n');
  }
  try{
    const target=direct?null:await forwarder.forward(scope.id,'tcp',relay.port,false),origin=direct?relay.url:`http://${target.host}:${target.port}`;
    server=http.createServer(async(req,res)=>{
      const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000);
      try{
        const requestUrl=new URL(req.url,'http://127.0.0.1'),suffix=requestUrl.pathname.slice(prefix.length);
        if(closed||!requestUrl.pathname.startsWith(prefix+'/')||!/^\/whip(?:\/[a-f0-9-]{36})?$/.test(suffix)||!['POST','PATCH','DELETE','OPTIONS'].includes(req.method))return res.writeHead(404).end();
        if(req.method==='DELETE')onDiagnostics({stage:'publisher-delete'});
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return res.writeHead(413).end();chunks.push(chunk);}
        const headers={Authorization:'Bearer '+relay.token};
        for(const key of ['content-type','if-match'])if(req.headers[key])headers[key]=req.headers[key];
        const body=chunks.length?await sdp(Buffer.concat(chunks).toString(),false):undefined;
        const response=await fetch(`${origin}/${relay.path}${suffix}`,{method:req.method,headers,body,redirect:'error',signal:controller.signal});
        const outgoing={};for(const key of ['content-type','etag','accept-patch'])if(response.headers.has(key))outgoing[key]=response.headers.get(key);
        if(response.headers.has('location')){
          const location=new URL(response.headers.get('location'),origin);
          if(location.origin!==origin||!location.pathname.startsWith('/'+relay.path+'/whip/'))throw Error('服务器返回了无效的推流会话');
          outgoing.Location=prefix+location.pathname.slice(relay.path.length+1);
        }
        const bytes=await response.text();if(bytes.length>1024*1024)throw Error('服务器返回的数据过大');
        const text=response.headers.get('content-type')?.includes('application/sdp')?await sdp(bytes,true):bytes;
        res.writeHead(response.status,outgoing).end(text);
      }catch{if(!res.headersSent)res.writeHead(502);res.end('服务器转发连接失败');}
      finally{clearTimeout(timer);controllers.delete(controller);}
    });
    server.requestTimeout=20000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    return {url:`http://127.0.0.1:${server.address().port}${prefix}/whip`,cancel,close(){return scopeClosing||=(async()=>{await cancel();await Promise.allSettled([...pacers.values()].map(async entry=>{await entry.ready.catch(()=>{});await entry.pacer.stop();}));await closeScope();})();}};
  }catch(error){server?.close();await closeScope().catch(()=>{});throw error;}
}
module.exports={createRelayPublisher,validateRelay};
