// Real EasyTier RPC verification, confined to loopback: no virtual adapters,
// public peers, STUN, UPnP or operating-system route changes.
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {allocateRpcPortal,createMemberRoutes}=require('../../main/member-routes.cjs');
const root=path.resolve(__dirname,'../..'),children=[];
const network='routes-test-'+randomUUID();
async function start(ip,peers=[],listener){
  const portal=await allocateRpcPortal(),instance=randomUUID();
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')));
  const args=['-i',ip+'/16','--no-tun','true','--network-name',network,'--network-secret',network,'--instance-name',instance,'--rpc-portal',portal,'--bind-device','false','--disable-p2p','true','--disable-ipv6','true','--disable-upnp','--stun-servers','--stun-servers-v6'];
  args.push(...(listener?['-l','tcp://'+listener]:['--no-listener']));if(peers.length)args.push('-p',...peers);
  const child=spawn(path.join(root,'res/easytier-core.exe'),args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
  let tail='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{tail=(tail+data).slice(-3000);});child.on('error',error=>{tail+=error.message;});
  const context={portal,instance};const reader=createMemberRoutes({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>context});
  return {reader,child,tail:()=>tail};
}
async function wait(node,predicate){const deadline=Date.now()+20000;while(Date.now()<deadline){const result=await node.reader.read();if(predicate(result))return result;if(node.child.exitCode!==null)throw Error(node.tail());await new Promise(resolve=>setTimeout(resolve,500));}throw Error('EasyTier RPC timeout: '+node.tail());}
(async()=>{try{
  const listen=await allocateRpcPortal();const relay=await start('10.144.240.1',[],listen);
  const a=await start('10.144.240.2',['tcp://'+listen]);
  const direct=await wait(a,result=>result.rows.some(row=>row.ip==='10.144.240.1'&&row.route==='p2p'));
  assert.equal(direct.rows.find(row=>row.ip==='10.144.240.1').protocol,'tcp');
  assert.equal(direct.rows.find(row=>row.ip==='10.144.240.2').route,'本机');
  const b=await start('10.144.240.3',['tcp://'+listen]);
  const indirect=await wait(a,result=>result.rows.some(row=>row.ip==='10.144.240.3'&&row.route==='relay(2)'));
  assert.equal(indirect.available,true);
  const listen6='[::1]:'+(await allocateRpcPortal()).split(':')[1];
  await start('10.144.240.4',[],listen6);
  const ipv6=await start('10.144.240.5',['tcp://'+listen6]);
  const direct6=await wait(ipv6,result=>result.rows.some(row=>row.ip==='10.144.240.4'&&row.route==='p2p'));
  assert.equal(direct6.rows.find(row=>row.ip==='10.144.240.4').protocol,'tcp6');
  console.log('MEMBER_ROUTES_NATIVE_OK',JSON.stringify({direct:'p2p',protocol:'tcp',ipv6:'tcp6',relay:'relay(2)',local:'本机',nodes:children.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const closed=once(child,'close');child.kill();await closed;}));}})();
