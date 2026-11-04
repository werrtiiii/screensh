// Synthetic color/silence only. Real MediaMTX/OBS/WebRTC and auth; sockets stay
// on this machine. SCREENSH_TEST_EASYTIER=true uses two isolated real no-TUN
// cores and production port forwarding; otherwise addresses use test mapping.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),dgram=require('node:dgram'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto');
const {io:connect}=require('../../../server/node_modules/socket.io-client');
const {createSignalingServer}=require('../../../server/server');
const {allocateRpcPortal}=require('../../main/member-routes.cjs'),{createRelayPublisher}=require('../../main/relay-publisher.cjs'),{ScreenObsRuntime}=require('../../main/screen-obs-runtime.cjs');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'.runtime-probe','relay-media-'+process.pid);

app.disableHardwareAcceleration();app.setPath('userData',path.join(directory,'profile'));app.on('window-all-closed',()=>{});
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>socket.timeout(4000).emit(event,payload,(error,result)=>error?reject(error):result.ok?resolve(result):reject(Error(result.message))));
app.whenReady().then(async()=>{let runtime,manager,bridge,obs,win,front,flow,mediaChild,realForwarder;const clients=[],cores=[];let logs='';
  const guard=setTimeout(()=>{console.error('RELAY_MEDIA_TIMEOUT');mediaChild?.kill();app.exit(1);},60000);
  try{
    const direct=process.env.SCREENSH_TEST_TUN==='true',publicRelay=process.env.SCREENSH_TEST_DIRECT==='true';
    const realNetwork=process.env.SCREENSH_TEST_EASYTIER==='true';assert.ok(!realNetwork||!direct,'real network probe uses no TUN and creates no adapters');
    const physical=Object.values(os.networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.')&&!item.address.startsWith('10.144.'))?.address;assert.ok(physical);
    assert.ok(!publicRelay||!realNetwork,'direct relay must not use an EasyTier media tunnel');
    const testHost=direct||publicRelay?physical:'10.144.0.1',bindHost=direct||publicRelay?physical:'127.0.0.1';
    const httpPort=Number((await allocateRpcPortal()).split(':').at(-1)),udpPort=Number((await allocateRpcPortal()).split(':').at(-1));
    if(realNetwork){
      const {createMemberRoutes}=require('../../main/member-routes.cjs'),{createTunnelForwarder}=require('../../main/tunnel-forwarder.cjs');
      const listener=await allocateRpcPortal(),network='relay-test-'+require('node:crypto').randomUUID();let clientContext;
      const transport=process.env.SCREENSH_TEST_TRANSPORT||'tcp';assert.ok(['tcp','udp'].includes(transport));
      assert.ok(!Object.values(os.networkInterfaces()).flat().some(row=>row?.address===testHost||row?.address==='10.144.0.2'),'probe addresses must not belong to real adapters');
      for(const [i,ip]of [testHost,'10.144.0.2'].entries()){
        const portal=await allocateRpcPortal(),instance=require('node:crypto').randomUUID(),context={portal,instance,noTun:true,virtualIp:ip};
        const args=['-i',ip+'/24','--no-tun','true','--network-name',network,'--network-secret',network,'--instance-name',instance,'--rpc-portal',portal,'--bind-device','false','--disable-p2p','true','--disable-ipv6','true','--disable-upnp','--stun-servers','--stun-servers-v6',...(i?['--no-listener','-p',transport+'://'+listener]:['-l',transport+'://'+listener])];
        const child=spawn(process.env.SCREENSH_TEST_EASYTIER_EXE||path.join(root,'res/easytier-core.exe'),args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')))});cores.push(child);
        for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{logs=(logs+bytes).slice(-12000);});
        if(i)clientContext=context;
      }
      const reader=createMemberRoutes({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>clientContext}),until=Date.now()+15000;
      while(!(await reader.read()).rows.some(row=>row.ip===testHost)){assert.ok(Date.now()<until,'real EasyTier peer must connect');await new Promise(resolve=>setTimeout(resolve,100));}
      realForwarder=createTunnelForwarder({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>clientContext});
      for(const [name,method]of [['openTunnelScope','open'],['forwardTunnelPort','forward'],['exposeTunnelPort','expose'],['closeTunnelScope','close']])ipcMain.handle(name,(_event,...args)=>realForwarder[method](...args));
    }
    runtime=createSignalingServer({initialPeers:'test.example:11010'});
    await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
    fs.mkdirSync(directory,{recursive:true});const configFile=path.join(directory,'external-mediamtx.json');
    fs.writeFileSync(configFile,JSON.stringify({logLevel:'info',rtsp:false,rtmp:false,hls:false,srt:false,playback:false,metrics:false,pprof:false,api:false,udpReadBufferSize:8388608,udpMaxPayloadSize:1200,authMethod:'http',authHTTPAddress:'http://127.0.0.1:'+runtime.server.address().port+'/media-relay/auth',authHTTPExclude:[],webrtc:true,webrtcAddress:bindHost+':'+httpPort,webrtcLocalUDPAddress:bindHost+':'+udpPort,webrtcLocalTCPAddress:bindHost+':'+udpPort,webrtcIPsFromInterfaces:false,webrtcAdditionalHosts:[testHost],paths:{'~^relay-[a-f0-9-]{36}$':{source:'publisher',overridePublisher:false}}}));
    mediaChild=spawn(process.env.SCREENSH_TEST_MEDIAMTX||path.join(root,'res/mediamtx.exe'),[configFile],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('MTX_'))),MTX_MOQ:'false'}});
    for(const stream of [mediaChild.stdout,mediaChild.stderr])stream.on('data',bytes=>{logs=(logs+bytes).slice(-12000);});
    const until=Date.now()+12000;while(true){try{const response=await fetch('http://'+bindHost+':'+httpPort+'/',{signal:AbortSignal.timeout(500)});if(response.status===404)break;}catch{}if(Date.now()>until||mediaChild.exitCode!==null)throw Error('External MediaMTX unavailable: '+logs);await new Promise(resolve=>setTimeout(resolve,100));}
    async function member(name,ip){const socket=connect('http://127.0.0.1:'+runtime.server.address().port,{transports:['websocket'],forceNew:true});clients.push(socket);await new Promise(resolve=>socket.once('connect',resolve));await request(socket,'join-server',{userName:name,virtualIp:ip,identity:randomBytes(32).toString('hex'),easytierPeers:['tcp://test.example:11010']});return socket;}
    const owner=await member('Owner','10.144.0.2'),viewer=await member('Viewer','10.144.0.3');
    await request(owner,'set-network-settings',{name:'external-network',secret:'test-secret',relayHost:publicRelay?'':testHost,relayPort:httpPort,...(publicRelay?{relayTransport:'direct',relayUrl:`http://${testHost}:${httpPort}`}:{})});
    const lease=await request(owner,'prepare-relay-share');
    const forwarder=realForwarder||{open:()=>({id:'test'}),forward:async(_id,protocol)=>({host:bindHost,port:protocol==='tcp'?httpPort:udpPort}),expose:async(_id,_host,port)=>({port}),close:async()=>{}};
    bridge=await createRelayPublisher({relay:lease,noTun:!direct,virtualIp:'10.144.0.2',forwarder});
    process.env.SCREENSH_TEST_SYNTHETIC='1';obs=new ScreenObsRuntime(path.join(directory,'obs'),message=>console.error('SYNTHETIC_OUTPUT',message),bridge.url,true);
    if(process.env.SCREENSH_TEST_MOTION==='true'){
      const pixels=randomBytes(256*144*3),header=Buffer.alloc(54);header.write('BM');header.writeUInt32LE(54+pixels.length,2);header.writeUInt32LE(54,10);header.writeUInt32LE(40,14);header.writeInt32LE(256,18);header.writeInt32LE(144,22);header.writeUInt16LE(1,26);header.writeUInt16LE(24,28);fs.mkdirSync(path.join(directory,'obs'),{recursive:true});fs.writeFileSync(path.join(directory,'obs/synthetic.bmp'),Buffer.concat([header,pixels]));
    }
    assert.ok(Array.isArray(await obs.sources([])),'native source enumeration runs in the worker');
    await obs.start({sourceType:'synthetic',resolution:process.env.SCREENSH_TEST_RESOLUTION||'320x180',frameRate:30,maxBitrate:5000,audioBitrate:64,videoEncoder:process.env.SCREENSH_TEST_ENCODER||'x264',shareAudio:false});
    await request(owner,'start-sharing',{relayPath:lease.path});const view=await request(process.env.SCREENSH_TEST_SELF==='true'?owner:viewer,'get-relay-view',{target:owner.id});
    front=dgram.createSocket('udp4');flow=dgram.createSocket('udp4');let browser;
    front.on('message',(bytes,remote)=>{browser=remote;flow.send(bytes,udpPort,bindHost);});flow.on('message',bytes=>{if(browser)front.send(bytes,browser.port,browser.address);});
    await new Promise(resolve=>front.bind(0,physical,resolve));const browserPort=front.address().port;
    const preload=path.join(directory,'network-preload.cjs');fs.writeFileSync(preload,'const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("electronAPI",Object.fromEntries(["openTunnelScope","forwardTunnelPort","exposeTunnelPort","closeTunnelScope"].map(key=>[key,(...args)=>ipcRenderer.invoke(key,...args)])));');
    win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,...(realNetwork?{preload}:{})}});await win.loadFile(path.join(root,'renderer/index.html'));
    const tunnel=publicRelay?'null':realNetwork?`(await import('./media-tunnel.mjs')).createMediaTunnel('${testHost}',true)`:`{http:async()=>({host:'${bindHost}',port:${httpPort}}),localDescription:async d=>d,localCandidate:async c=>c,remoteDescription:async d=>({...d,sdp:d.sdp.replaceAll('${testHost} ${udpPort}','${physical} ${browserPort}')}),close:()=>{}}`;
    await win.webContents.executeJavaScript(`(async()=>{const {WhepSession}=await import('./whep.mjs');window.relayTestError='';window.relayTestVideo=document.createElement('video');relayTestVideo.muted=true;relayTestVideo.autoplay=true;document.body.append(relayTestVideo);window.relaySession=new WhepSession('http://${testHost}:${httpPort}/${view.path}/whep',{},event=>{relayTestVideo.srcObject??=new MediaStream();relayTestVideo.srcObject.addTrack(event.track);void relayTestVideo.play();},error=>{relayTestError=error.message;},{getToken:async()=>${JSON.stringify(view.token)},tunnel:${tunnel},virtualIp:'10.144.0.2'});await relaySession.start();})()`,true);
    const deadline=Date.now()+15000;let frames=0;while(Date.now()<deadline){const result=await win.webContents.executeJavaScript(`({error:relayTestError,frames:relayTestVideo.getVideoPlaybackQuality().totalVideoFrames})`);if(result.error)throw Error(result.error);frames=result.frames;if(frames>3)break;await new Promise(r=>setTimeout(r,100));}assert.ok(frames>3,'viewer decodes real relayed video');
    if(realNetwork||process.env.SCREENSH_TEST_SUSTAINED==='true'){
      const duration=Math.min(30000,Number(process.env.SCREENSH_TEST_DURATION)||8000);await new Promise(resolve=>setTimeout(resolve,duration));
      const stats=await win.webContents.executeJavaScript(`(async()=>{const rows=[...(await relaySession.pc.getStats()).values()];const v=rows.find(r=>r.type==='inbound-rtp'&&r.kind==='video');return {frames:v?.framesDecoded,received:v?.packetsReceived,lost:v?.packetsLost,freezes:v?.totalFreezesDuration,error:relayTestError};})()`);
      console.log(realNetwork?'REAL_EASYTIER_VIDEO_STATS':'RELAY_VIDEO_STATS',JSON.stringify(stats));assert.equal(stats.error,'');assert.ok(stats.frames>=duration/1000*22.5,'sustained relayed video decoding');assert.ok(stats.lost<=3,'receiver RTP loss budget');
      assert.ok(!/\d+ RTP packets lost|invalid FU-A/.test(logs),'publisher RTP must arrive without the reproduced loss');
    }
    if(process.env.SCREENSH_TEST_SELF!=='true'){
      const channel=(await request(owner,'create-channel',{name:'Other'})).channel.id;await request(viewer,'switch-channel',{channelId:channel});
      const check=await fetch('http://127.0.0.1:'+runtime.server.address().port+'/media-relay/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:'webrtc',action:'read',path:view.path,token:view.token})});assert.equal(check.status,403,'channel departure revokes new reading requests');
    }
    await win.webContents.executeJavaScript('relaySession.close()');const stoppedAt=Date.now();await obs.stopAndWait();console.log('OBS_STOP_MS',Date.now()-stoppedAt);assert.ok(Date.now()-stoppedAt<5000,'relay publisher stops without blocking the loopback HTTP server');
    await request(owner,'stop-sharing');
    const disabled=await request(owner,'set-video-relay',{enabled:false});assert.equal(disabled.videoRelay.ready,false);assert.equal(mediaChild.exitCode,null,'external MediaMTX is never stopped by the signaling server');
    console.log('REAL_VIDEO_RELAY_OK',JSON.stringify({frames,publisher:'native OBS',viewer:'WebRTC',auth:true,channelRevocation:process.env.SCREENSH_TEST_SELF!=='true',externalProcessUnaffected:true,noTunPublisherBridge:!direct,selfView:process.env.SCREENSH_TEST_SELF==='true'}));
  }catch(error){console.error(error.stack);console.error(logs);process.exitCode=1;}
  finally{clearTimeout(guard);win?.destroy();try{await obs?.shutdown();}catch{}await bridge?.close();await realForwarder?.clear();for(const core of cores){if(core.exitCode===null){const exited=new Promise(resolve=>core.once('close',resolve));core.kill();await exited;}}try{front?.close();flow?.close();}catch{}for(const client of clients)client.disconnect();if(mediaChild&&mediaChild.exitCode===null&&!mediaChild.signalCode){const exited=new Promise(resolve=>mediaChild.once('close',resolve));mediaChild.kill();await exited;}if(runtime)await new Promise(resolve=>runtime.io.close(resolve));app.exit(process.exitCode||0);}
});
