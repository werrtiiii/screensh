// Only connects local processes. No TUN, STUN, public peers or firewall changes.
const {spawn}=require('node:child_process'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {allocateRpcPortal,createMemberRoutes}=require('../../main/member-routes.cjs');
const root=path.resolve(__dirname,'../..'),children=[];
const host=Object.values(os.networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.')&&!item.address.startsWith('10.144.'))?.address;
async function start(ip,network,listeners,peers,disableP2p){
  const {EASYTIER_CONNECTION_ARGS}=await import('../../renderer/easytier-options.mjs');
  const context={portal:await allocateRpcPortal(),instance:randomUUID()};
  const args=['-i',ip+'/16','--no-tun','true','--network-name',network,'--network-secret',network,'--instance-name',context.instance,'--rpc-portal',context.portal,'--bind-device','false','--disable-p2p',String(disableP2p),'--disable-tcp-hole-punching','true','--disable-udp-hole-punching','true','--disable-upnp','--disable-ipv6','true','--stun-servers','--stun-servers-v6',...EASYTIER_CONNECTION_ARGS,'-l',...listeners];
  if(peers.length)args.push('-p',...peers);
  const child=spawn(path.join(root,'res/easytier-core.exe'),args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')))});children.push(child);let tail='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{tail=(tail+data).slice(-3000);});child.on('error',error=>{tail+=error.message;});
  const reader=createMemberRoutes({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>context});return {child,reader,tail:()=>tail};
}
async function wait(node,ip,protocol){const until=Date.now()+35000;while(Date.now()<until){const result=await node.reader.read(),row=result.rows.find(row=>row.ip===ip);if(row?.route==='p2p'&&row.protocol.split(',').includes(protocol))return row;if(node.child.exitCode!==null)throw Error(node.tail());await new Promise(resolve=>setTimeout(resolve,500));}throw Error('Direct '+protocol+' not established: '+node.tail());}
async function scenario(udp){
  const network='udp-priority-'+randomUUID(),relayAddress=await allocateRpcPortal();
  await start('10.144.241.1',network,['tcp://'+relayAddress],[],true);
  const listeners=async()=>{const port=(await allocateRpcPortal()).split(':')[1];return ['tcp://'+host+':'+port,...(udp?['udp://'+host+':'+port]:[])];};
  const a=await start('10.144.241.2',network,await listeners(),['tcp://'+relayAddress],false);
  const b=await start('10.144.241.3',network,await listeners(),['tcp://'+relayAddress],false);
  return wait(a,'10.144.241.3',udp?'udp':'tcp');
}
(async()=>{try{
  if(!host)throw Error('No local non-loopback IPv4 available for direct-discovery test');
  const udp=await scenario(true),tcp=await scenario(false);
  assert.equal(udp.route,'p2p');assert.equal(tcp.route,'p2p');
  console.log('UDP_PRIORITY_NATIVE_OK',JSON.stringify({preferred:udp.protocol,fallback:tcp.protocol,bootstrap:'tcp',nodes:children.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const closed=once(child,'close');child.kill();await closed;}));}})();
