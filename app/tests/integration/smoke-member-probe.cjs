// Owned, loopback-only EasyTier cores. No TUN adapters or public relay services.
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {randomUUID}=require('node:crypto');
const dgram=require('node:dgram'),path=require('node:path'),assert=require('node:assert/strict');
const {allocateRpcPortal,createMemberRoutes}=require('../../main/member-routes.cjs');
const {createTunnelForwarder}=require('../../main/tunnel-forwarder.cjs');
const {createMemberProbe}=require('../../main/member-probe.cjs');
const {createMemberLatency}=require('../../main/member-latency.cjs');
const root=path.resolve(__dirname,'../..'),cores=[],forwarders=[],probes=[],network='probe-'+randomUUID();
async function core(ip,peers=[],listener,relay=false) {
  const portal=await allocateRpcPortal(),instance=randomUUID();
  const args=['-i',ip+'/16','--no-tun','true','--network-name',network+(relay?'-relay':''),'--network-secret',network+(relay?'-relay':''),'--instance-name',instance,'--rpc-portal',portal,'--bind-device','false','--disable-p2p','true','--disable-ipv6','true','--disable-upnp','--stun-servers','--stun-servers-v6',...(listener?['-l','tcp://'+listener]:['--no-listener']),...(peers.length?['-p',...peers]:[])];
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')));
  const child=spawn(path.join(root,'res/easytier-core.exe'),args,{windowsHide:true,env,stdio:['ignore','pipe','pipe']});cores.push(child);
  let tail='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{tail=(tail+bytes).slice(-4000);});child.on('error',error=>{tail+=error.message;});
  const context={portal,instance,noTun:true,virtualIp:ip},reader=createMemberRoutes({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>context});
  return {context,reader,child,tail:()=>tail};
}
(async()=>{let guard;try {
  const listener=await allocateRpcPortal();await core('10.144.241.3',[],listener,true);
  const a=await core('10.144.241.1',['tcp://'+listener]),b=await core('10.144.241.2',['tcp://'+listener]);
  const until=Date.now()+30000;let route;
  while(Date.now()<until){route=(await a.reader.read()).rows.find(row=>row.ip===b.context.virtualIp);if(route?.route==='relay(2)')break;await new Promise(resolve=>setTimeout(resolve,300));}
  assert.equal(route?.route,'relay(2)',a.tail());
  guard=dgram.createSocket('udp4');await new Promise(resolve=>guard.bind(0,'127.0.0.1',resolve));const port=guard.address().port;guard.close();guard=null;
  const forwarder=createTunnelForwarder({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>a.context});forwarders.push(forwarder);
  // Separate loopback bindings let both simulated machines own the same port.
  // Only B receives inbound traffic here, as EasyTier routes remote UDP to 127.0.0.1.
  const responder=createMemberProbe({getContext:()=>b.context,forwarder,port});probes.push(responder);await responder.start();
  const requester=createMemberProbe({getContext:()=>a.context,forwarder,port,bindHost:'127.0.0.2',timeout:3000});probes.push(requester);await requester.start();
  const latency=createMemberLatency({getContext:()=>a.context,probe:requester,pinger:{ping:()=>{throw Error('no TUN must not use ICMP');}},routes:a.reader});
  const result=await latency.ping(b.context.virtualIp);assert.ok(Number.isFinite(result.rttMs)&&result.rttMs>0,JSON.stringify(result));assert.equal(result.source,'probe');
  assert.deepEqual(await latency.ping(b.context.virtualIp),result);
  console.log('MEMBER_RELAY_RTT_OK',JSON.stringify({route:route.route,...result,realEasyTier:true}));
}catch(error){console.error(error.stack);process.exitCode=1;}
finally {guard?.close();await Promise.all(probes.map(probe=>probe.stop()));await Promise.all(forwarders.map(forwarder=>forwarder.clear()));await Promise.all(cores.map(async child=>{if(child.exitCode!==null)return;const done=once(child,'close');child.kill();await done;}));}})();
