// Two owned no-TUN cores on loopback; no adapters, public peers or STUN.
// Compare executables using SCREENSH_TEST_EASYTIER_EXE. Prints loss metrics.
const {spawn}=require('node:child_process'),{once}=require('node:events');
const path=require('node:path'),dgram=require('node:dgram'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {allocateRpcPortal,createMemberRoutes}=require('../../main/member-routes.cjs');
const {createTunnelForwarder}=require('../../main/tunnel-forwarder.cjs');
const root=path.resolve(__dirname,'../..'),children=[],network='udp-buffer-test-'+randomUUID();
const exe=process.env.SCREENSH_TEST_EASYTIER_EXE||path.join(root,'res/easytier-core.exe');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let forwarder,backend,client;
  try{
    const listener=await allocateRpcPortal();let context;
    for(const [i,ip]of ['10.144.245.1','10.144.245.2'].entries()){
      const portal=await allocateRpcPortal(),instance=randomUUID();
      const args=['-i',ip+'/24','--no-tun','true','--network-name',network,'--network-secret',network,'--instance-name',instance,'--rpc-portal',portal,'--bind-device','false','--disable-p2p','true','--disable-ipv6','true','--disable-upnp','--stun-servers','--stun-servers-v6',...(i?['--no-listener','-p','tcp://'+listener]:['-l','tcp://'+listener])];
      const child=spawn(exe,args,{windowsHide:true,stdio:'ignore',env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')))});children.push(child);
      if(i)context={portal,instance,noTun:true,virtualIp:ip};
    }
    const reader=createMemberRoutes({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>context}),until=Date.now()+15000;
    while(!(await reader.read()).rows.some(row=>row.ip==='10.144.245.1')){assert.ok(Date.now()<until,'peers connect');await pause(100);}
    forwarder=createTunnelForwarder({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>context});
    backend=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024,sendBufferSize:2*1024*1024});backend.bind(0,'127.0.0.1');await once(backend,'listening');
    client=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024,sendBufferSize:2*1024*1024});client.bind(0,'127.0.0.1');await once(client,'listening');
    const scope=forwarder.open('10.144.245.1'),target=await forwarder.forward(scope.id,'udp',backend.address().port,false),up=new Set(),down=new Set();let ready=false;
    backend.on('message',(bytes,remote)=>{if(bytes.length===1)ready=true;else up.add(bytes.readUInt32BE());backend.send(bytes,remote.port,remote.address,()=>{});});
    client.on('message',bytes=>{if(bytes.length>1)down.add(bytes.readUInt32BE());});
    for(let i=0;i<30&&!ready;i++){client.send(Buffer.from([1]),target.port,target.host);await pause(100);}assert.ok(ready,'UDP mapping ready');
    const count=1200,burstSize=Math.min(count,Math.max(1,Number(process.env.SCREENSH_TEST_UDP_BURST)||8));
    for(let i=0;i<count;){for(let burst=0;burst<burstSize&&i<count;burst++,i++){const bytes=Buffer.alloc(1200);bytes.writeUInt32BE(i);client.send(bytes,target.port,target.host,()=>{});}await pause(2);}
    await pause(1500);console.log('EASYTIER_UDP_BUFFER_PROBE',JSON.stringify({exe:path.basename(exe),sent:count,up:up.size,down:down.size,uploadLost:count-up.size,downloadLost:up.size-down.size}));
  }finally{
    await forwarder?.clear();backend?.close();client?.close();
    await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const closed=once(child,'close');child.kill();await closed;}));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
