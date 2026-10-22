const {execFile}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {isIPv4}=require('node:net');
const dgram=require('node:dgram');
const os=require('node:os');
const {allocateRpcPortal}=require('./member-routes.cjs');
// Screen-share keyframes arrive as UDP bursts. Windows' default socket queue
// can overflow before the main-process event loop drains a complete burst.
function mediaSocket(){return dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024,sendBufferSize:512*1024});}
async function udpAddress(){const socket=dgram.createSocket('udp4');return new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve('127.0.0.1:'+port));});});}
function localMediaHost(){const addresses=Object.values(os.networkInterfaces()).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.'));return addresses.find(item=>!item.address.startsWith('10.144.'))?.address||addresses[0]?.address;}
async function browserRelay(targetPort){
  const host=localMediaHost();if(!host)throw Error('没有可用的本机 IPv4 网络');const front=mediaSocket(),flows=new Map();let closed=false;
  // Windows adapter enumeration can take several milliseconds. Doing it per
  // video packet blocks voice forwarding on the same event loop. A relay is
  // bound to one interface for its lifetime; snapshot the local allowlist once.
  const localAddresses=new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item=>item.address));
  front.on('error',()=>{});front.on('message',(bytes,remote)=>{if(closed||!localAddresses.has(remote.address))return;const key=remote.address+':'+remote.port;let socket=flows.get(key);if(!socket){if(flows.size>=32)return;socket=mediaSocket();socket.on('error',()=>{});socket.on('message',(reply,source)=>{if(!closed&&source.address==='127.0.0.1'&&source.port===targetPort)front.send(reply,remote.port,remote.address,()=>{});});flows.set(key,socket);}socket.send(bytes,targetPort,'127.0.0.1',()=>{});});
  await new Promise((resolve,reject)=>{front.once('error',reject);front.bind(0,host,resolve);});return {host,port:front.address().port,close(){closed=true;for(const socket of flows.values())socket.close();front.close();}};
}
function createTunnelForwarder({exe,getContext,execute=execFile}){
  const scopes=new Map();let revision=0,commands=Promise.resolve(),anchor;
  const command=(context,args)=>{const work=()=>new Promise((resolve,reject)=>execute(exe,['-p',context.portal,'-n',context.instance,'port-forward',...args],{windowsHide:true,encoding:'utf8',timeout:8000,maxBuffer:1024*1024},error=>error?reject(Error('无法配置 EasyTier 端口转发')):resolve()));const result=commands.then(work);commands=result.catch(()=>{});return result;};
  // EasyTier 2.6.4 drops its userspace stack when its last rule is removed,
  // but does not recreate it for the same VIP. Keep one inactive loopback TCP
  // rule for the core's lifetime; media scopes still release their own rules.
  function keepStack(context){if(anchor?.context===context)return anchor.promise;const entry=anchor={context};entry.promise=(async()=>{entry.bind=await allocateRpcPortal();entry.dst=(context.virtualIp||'10.144.0.1')+':9';await command(context,['add','tcp',entry.bind,entry.dst]);})().catch(error=>{if(anchor===entry)anchor=null;throw error;});return entry.promise;}
  function open(ip){const context=getContext();if(!context)throw Error('虚拟网络未连接');if(!isIPv4(ip)||!ip.startsWith('10.144.'))throw Error('无效的成员虚拟地址');if(scopes.size>=512)throw Error('转发会话过多');const id=randomUUID();scopes.set(id,{context,ip,maps:new Map(),ingress:new Map(),closed:false,revision});return {id,forward:!!context.noTun};}
  async function expose(id,host,port){const scope=scopes.get(id);if(!scope||scope.closed||scope.context!==getContext())throw Error('转发会话已关闭');
    if(!scope.context.noTun)return {port};
    if(!isIPv4(host)||!Object.values(os.networkInterfaces()).flat().some(item=>item?.address===host)||!Number.isInteger(port)||port<1024||port>65535)throw Error('无效的本机媒体地址');
    const key=host+':'+port;if(scope.ingress.has(key))return scope.ingress.get(key).promise;if(scope.ingress.size>=16)throw Error('本机会话端口过多');
    const front=mediaSocket(),flows=new Map(),entry={front,flows};scope.ingress.set(key,entry);
    front.on('error',()=>{});front.on('message',(bytes,remote)=>{if(scope.closed||remote.address!=='127.0.0.1')return;const remoteKey=remote.address+':'+remote.port;let flow=flows.get(remoteKey);if(!flow){if(flows.size>=32)return;const socket=mediaSocket();flow={socket,touched:Date.now()};flows.set(remoteKey,flow);socket.on('error',()=>{});socket.on('message',(reply,source)=>{if(!scope.closed&&source.address===host&&source.port===port)front.send(reply,remote.port,remote.address,()=>{});});}flow.touched=Date.now();flow.socket.send(bytes,port,host,()=>{});});
    entry.timer=setInterval(()=>{for(const [key,flow] of flows)if(Date.now()-flow.touched>120000){try{flow.socket.close();}catch{}flows.delete(key);}},30000);entry.timer.unref();
    entry.promise=new Promise((resolve,reject)=>{front.once('error',reject);front.bind(0,'127.0.0.1',()=>{if(scope.closed)return reject(Error('转发会话已关闭'));resolve({port:front.address().port});});}).catch(error=>{clearInterval(entry.timer);try{front.close();}catch{}scope.ingress.delete(key);throw error;});return entry.promise;
  }
  async function forward(id,protocol,port,browser=true){const scope=scopes.get(id);if(!scope||scope.closed||scope.context!==getContext())throw Error('转发会话已关闭');if(!['tcp','udp'].includes(protocol)||!Number.isInteger(port)||port<1024||port>65535)throw Error('无效的转发端口');if(!scope.context.noTun)return {host:scope.ip,port};
    const key=protocol+':'+port+':'+browser;if(scope.maps.has(key))return scope.maps.get(key).promise;if(scope.maps.size>=64)throw Error('会话转发端口过多');
    const entry={protocol,dst:scope.ip+':'+port,bind:null};scope.maps.set(key,entry);
    entry.promise=(async()=>{if(scope.ip===scope.context.virtualIp){if(protocol==='tcp')return {host:'127.0.0.1',port};if(browser){entry.relay=await browserRelay(port);if(scope.closed)throw Error('转发会话已关闭');return {host:entry.relay.host,port:entry.relay.port};}return {host:'127.0.0.1',port};}await keepStack(scope.context);if(scope.closed||scope.context!==getContext())throw Error('转发会话已关闭');entry.bind=protocol==='udp'?await udpAddress():await allocateRpcPortal();await command(scope.context,['add',protocol,entry.bind,entry.dst]);if(scope.closed||scope.context!==getContext()){await command(scope.context,['remove',protocol,entry.bind,entry.dst]).catch(()=>{});throw Error('转发会话已关闭');}const localPort=Number(entry.bind.split(':')[1]);if(protocol==='udp'&&browser){entry.relay=await browserRelay(localPort);if(scope.closed){entry.relay.close();throw Error('转发会话已关闭');}return {host:entry.relay.host,port:entry.relay.port};}return {host:'127.0.0.1',port:localPort};})().catch(async error=>{try{entry.relay?.close();}catch{}if(entry.bind&&scope.context===getContext())await command(scope.context,['remove',protocol,entry.bind,entry.dst]).catch(()=>{});scope.maps.delete(key);throw error;});return entry.promise;
  }
  async function close(id){const scope=scopes.get(id);if(!scope)return;scopes.delete(id);scope.closed=true;for(const entry of scope.ingress.values()){clearInterval(entry.timer);for(const flow of entry.flows.values())try{flow.socket.close();}catch{}try{entry.front.close();}catch{}}await Promise.all([...scope.maps.values()].map(async entry=>{await entry.promise.catch(()=>{});try{entry.relay?.close();}catch{}if(entry.bind&&scope.context===getContext())await command(scope.context,['remove',entry.protocol,entry.bind,entry.dst]).catch(()=>{});}));}
  async function clear(){revision++;await Promise.all([...scopes.keys()].map(close));const entry=anchor;anchor=null;if(entry){await entry.promise.catch(()=>{});if(entry.context===getContext()&&entry.bind)await command(entry.context,['remove','tcp',entry.bind,entry.dst]).catch(()=>{});}await commands;}
  return {open,forward,expose,close,clear};
}
module.exports={createTunnelForwarder};
