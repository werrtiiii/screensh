// Real three-member voice, encrypted lolPing, OBS/WHEP and rule cleanup,
// confined to loopback EasyTier peers: no public peers, STUN or UPnP.
// Default: no virtual adapters or routes. Mixed mode: one owned temporary TUN
// adapter with a dedicated /30 route, requiring Windows administrator rights.
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {allocateRpcPortal,createMemberRoutes}=require('../../main/member-routes.cjs');
const root=path.resolve(__dirname,'../..'),children=[],nodes=[];
const mixed=process.env.SCREENSH_TEST_MIXED_TUN==='1',device='ss-test-'+randomUUID().slice(0,6);
const relayed=process.env.SCREENSH_TEST_RELAY==='1';
const publicPeers=process.env.SCREENSH_TEST_RELAY_PEERS?JSON.parse(process.env.SCREENSH_TEST_RELAY_PEERS):null;
const network='routes-test-'+randomUUID();
const transport=process.env.SCREENSH_TEST_TRANSPORT||'tcp';
assert.ok(['tcp','udp','tcp6','udp6'].includes(transport));
const peerUrl=address=>transport.replace(/6$/,'')+'://'+(transport.endsWith('6')?'[::1]:'+address.split(':').at(-1):address);
async function start(ip,peers=[],listener,noTun=true,foreign=false){
  const portal=await allocateRpcPortal(),instance=randomUUID();
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')));
  const args=['-i',ip+(mixed?'/30':'/16'),'--no-tun',String(noTun),'--network-name',network,'--network-secret',network,'--instance-name',instance,'--rpc-portal',portal,'--bind-device','false','--disable-p2p','true','--disable-ipv6',String(!transport.endsWith('6')),'--disable-upnp','--stun-servers','--stun-servers-v6'];
  if(!noTun)args.push('--dev-name',device);
  if(foreign){args[args.indexOf('--network-name')+1]=network+'-relay';args[args.indexOf('--network-secret')+1]=network+'-relay';}
  if(!foreign&&(process.env.SCREENSH_TEST_DISABLE_ENCRYPTION==='1'||process.env.SCREENSH_TEST_MISMATCH_ENCRYPTION==='1'&&ip==='10.144.242.1'))args.push('--disable-encryption','true');
  args.push(...(listener?['-l',peerUrl(listener)]:['--no-listener']));if(peers.length)args.push('-p',...peers);
  const child=spawn(path.join(root,'res/easytier-core.exe'),args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
  let tail='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{tail=(tail+data).slice(-3000);});child.on('error',error=>{tail+=error.message;});
  const context={portal,instance};nodes.push(context);const reader=createMemberRoutes({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>context});
  return {reader,child,context:{...context,noTun,virtualIp:ip},tail:()=>tail};
}
async function wait(node,predicate){const deadline=Date.now()+20000;while(Date.now()<deadline){const result=await node.reader.read();if(predicate(result))return result;if(node.child.exitCode!==null)throw Error(node.tail());await new Promise(resolve=>setTimeout(resolve,500));}throw Error('EasyTier RPC timeout: '+node.tail());}


const {app,BrowserWindow,ipcMain}=require('electron');
const {createTunnelForwarder}=require('../../main/tunnel-forwarder.cjs');
const {EasyTierLolPing}=require('../../lolping/easytier.cjs');
const {ManagedProcess}=require('../../main/managed-process');
const {ObsEngine}=require('../../main/obs-engine');
const stress=process.env.SCREENSH_TEST_STRESS==='1';
const audioTiming=require('../../main/audio-timing.cjs').createAudioTiming({exe:path.join(root,'res/screensh-media-udp.exe'),getProcesses:()=>app.getAppMetrics()});
if(process.env.SCREENSH_TEST_BACKGROUND_POLICY!=='0')require('../../main/realtime-policy.cjs').configureRealtimeScheduling(app.commandLine);
function assertVoiceSamples(samples){
  const steady=samples.slice(10).flat();assert.ok(steady.length>=10,'concurrent voice must be sampled long enough');
  for(const sample of steady){assert.ok(sample.buffer!==null&&sample.buffer<150,'voice buffer must recover and remain below 150ms');assert.ok(sample.loss!==null&&sample.loss<1,'concurrent voice packet loss');assert.ok(sample.concealment!==null&&sample.concealment<1,'concurrent voice loss concealment');}
}
class SyntheticEngine extends ObsEngine{createSource(){if(stress){const width=process.env.SCREENSH_TEST_EXTREME_NOISE==='1'?1920:256,height=process.env.SCREENSH_TEST_EXTREME_NOISE==='1'?1080:144,pixels=require('node:crypto').randomBytes(width*height*3),header=Buffer.alloc(54);header.write('BM');header.writeUInt32LE(header.length+pixels.length,2);header.writeUInt32LE(54,10);header.writeUInt32LE(40,14);header.writeInt32LE(width,18);header.writeInt32LE(height,22);header.writeUInt16LE(1,26);header.writeUInt16LE(24,28);const file=path.join(root,'.runtime-probe/no-tun/stress.bmp');fs.writeFileSync(file,Buffer.concat([header,pixels]));const image=this.osn.InputFactory.create('image_source','no-tun-texture',{file});if(process.env.SCREENSH_TEST_MOTION==='1'){const filter=this.osn.FilterFactory.create('scroll_filter','stress-motion',{speed_x:160,speed_y:90,loop:true});image.addFilter(filter);filter.release();}return image;}return this.osn.InputFactory.create('color_source_v3','no-tun-color',{width:320,height:180,color:0xffff6600});}}
app.disableHardwareAcceleration();app.setPath('userData',path.join(root,'.runtime-probe/no-tun/profile'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let win,obs,pacer;const forwarders=[],transports=[],mtx=new ManagedProcess('No TUN MediaMTX');const timeout=setTimeout(()=>{console.error('NO_TUN_TIMEOUT');for(const child of children)if(child.exitCode===null)child.kill();mtx.stop();app.exit(1);},stress?240000:120000);try{
  assert.ok(!Object.values(require('node:os').networkInterfaces()).flat().some(row=>row?.address.startsWith('10.144.242.')),'test subnet must be unused');
  const listen=await allocateRpcPortal();if(relayed&&!publicPeers)await start('10.144.242.3',[],listen,true,true);
  const bootPeers=publicPeers||[peerUrl(listen)];
  const a=await start('10.144.242.1',relayed?bootPeers:[],relayed?null:listen,!mixed),b=await start('10.144.242.2',bootPeers),c=mixed||relayed?null:await start('10.144.242.3',[peerUrl(listen)]);await wait(a,result=>result.rows.some(row=>row.ip===(mixed||relayed?'10.144.242.2':'10.144.242.3')&&(!relayed||row.route==='relay(2)')));
  if(relayed)console.log('RELAY_PATH_READY');
  if(mixed){const deadline=Date.now()+15000;while(!Object.values(require('node:os').networkInterfaces()).flat().some(row=>row?.address===a.context.virtualIp)){if(Date.now()>deadline)throw Error('TUN adapter not ready: '+a.tail());await new Promise(r=>setTimeout(r,100));}console.log('MIXED_TUN_ADAPTER_READY',device);}
  for(const node of [a,b,c].filter(Boolean))forwarders.push(createTunnelForwarder({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>node.context}));
  for(const [name,method] of [['openTunnelScope','open'],['forwardTunnelPort','forward'],['exposeTunnelPort','expose'],['closeTunnelScope','close']])ipcMain.handle(name,(_event,side,...args)=>forwarders[side][method](...args));
  const preload=path.join(root,'.runtime-probe/no-tun/preload.cjs');fs.writeFileSync(preload,'const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("network",Object.fromEntries(["openTunnelScope","forwardTunnelPort","exposeTunnelPort","closeTunnelScope"].map(key=>[key,(...args)=>ipcRenderer.invoke(key,...args)])));');
  win=new BrowserWindow({show:false,webPreferences:{preload,backgroundThrottling:false}});win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.log('NO_TUN_RENDERER',message);});await win.loadFile(path.join(__dirname,'no-tun-browser.html'));
  const run=code=>win.webContents.executeJavaScript(code,true);for(let i=0;i<100&&!await run('typeof voiceNoTunProbe==="function"');i++)await new Promise(r=>setTimeout(r,20));
  if(mixed)await run('window.testModes=[false,true];window.testPairs=[[0,1],[1,0]]');
  else if(relayed)await run('window.testPairs=[[0,1],[1,0]]');
  if(stress)await run('window.watchDurationMs='+Math.min(60000,Number(process.env.SCREENSH_TEST_WATCH_MS)||20000));
  if(process.env.SCREENSH_TEST_CONCURRENT_VOICE==='1')await run('window.keepVoiceAlive=true;window.testPairs=[[0,1]]');
  if(process.env.SCREENSH_TEST_MISMATCH_ENCRYPTION==='1'){let failure;try{await run('voiceNoTunProbe()');}catch(error){failure=error;}assert.match(String(failure),/voice failed/,'mismatched encryption must reproduce media failure after route discovery');console.log('RELAY_ENCRYPTION_MISMATCH_REPRODUCED',String(failure));return;}
  if(!process.env.SCREENSH_TEST_SKIP_VOICE){const voice=await run('voiceNoTunProbe()');console.log('NO_TUN_VOICE_OK',JSON.stringify(voice));}
  if(process.env.SCREENSH_TEST_AUDIO_TIMING!=='0')await audioTiming.setActive(true);
  const serverId=randomUUID(),packets=[];for(const [index,node] of [a,b].entries()){const transport=new EasyTierLolPing({context:{serverId,channelId:'main',socketId:'peer-'+index,virtualIp:node.context.virtualIp,noTun:node.context.noTun},forwarder:forwarders[index],validEvent:()=>true,onPacket:packet=>packets.push({...packet,receiver:index}),onError:error=>console.error(error)});transports.push(transport);await transport.start();}
  transports[0].updatePeers([{socketId:'peer-1',channelId:'main',virtualIp:b.context.virtualIp,lolpingEndpoint:transports[1].endpoint}]);transports[1].updatePeers([{socketId:'peer-0',channelId:'main',virtualIp:a.context.virtualIp,lolpingEndpoint:transports[0].endpoint}]);
  for(let i=0;i<100&&new Set(packets.map(packet=>packet.receiver)).size<2;i++){transports.forEach(transport=>transport.send({kind:'ping',id:'normal',x:.5,y:.5,monitor:0}));await new Promise(r=>setTimeout(r,100));}if(new Set(packets.map(packet=>packet.receiver)).size<2)console.log('NO_TUN_LOLPING_STATE',JSON.stringify(transports.map(t=>({peers:[...t.peers.values()].map(p=>({ip:p.ip,port:p.port,sendPort:p.sendPort})),flows:[...t.forwardFlows],scopes:[...t.forwardScopes]}))));assert.equal(new Set(packets.map(packet=>packet.receiver)).size,2,'encrypted lolPing crosses no TUN forwards');console.log('NO_TUN_LOLPING_OK',packets.length);
  for(const publisher of mixed?[1,0]:[1]){
    if(stress)await run('window.watchDurationMs='+Math.min(60000,Number(process.env.SCREENSH_TEST_WATCH_MS)||20000));
    const owner=[a,b][publisher].context,host=owner.noTun?'127.0.0.1':owner.virtualIp;
    const httpPort=Number((await allocateRpcPortal()).split(':')[1]),mediaPort=Number((await allocateRpcPortal()).split(':')[1]);
    if(owner.noTun&&process.env.SCREENSH_TEST_PACER!=='0'){pacer=require('../../main/media-udp-pacer.cjs').createMediaUdpPacer({port:mediaPort});await pacer.start();}
    await mtx.start(path.join(root,'res/mediamtx.exe'),[path.join(root,'mediamtx.yml')],{cwd:path.join(root,'res'),ready:log=>/\[WebRTC\] listener opened/.test(log),env:{...process.env,MTX_WEBRTCADDRESS:host+':'+httpPort,MTX_WEBRTCLOCALUDPADDRESS:(pacer?'127.0.0.2':host)+':'+mediaPort,MTX_WEBRTCLOCALTCPADDRESS:host+':'+mediaPort,MTX_WEBRTCIPSFROMINTERFACES:'false',MTX_WEBRTCADDITIONALHOSTS:owner.virtualIp+(owner.noTun?',127.0.0.1':'')}});
    obs=new SyntheticEngine(path.join(root,'.runtime-probe/no-tun/obs'),undefined,'http://'+host+':'+httpPort+'/live/whip',true);obs.init();await obs.start({sourceId:'Auto',videoEncoder:'x264',resolution:stress?'1920x1080':'640x360',frameRate:stress?30:10,maxBitrate:stress?5000:1000,audioBitrate:128,shareAudio:false});await mtx.waitForOutput(/\[path live\] stream is available/);
    if(process.env.SCREENSH_TEST_NO_VIEWER==='1'){
      const samples=[],until=Date.now()+(Number(process.env.SCREENSH_TEST_WATCH_MS)||30000);
      while(Date.now()<until){samples.push(await run('sampleVoiceLoad()'));await new Promise(resolve=>setTimeout(resolve,1000));}
      console.log('NO_VIEWER_VOICE_STATS',JSON.stringify({publisher,samples}));assertVoiceSamples(samples);
      obs.stop();obs.shutdown();obs=null;await mtx.stop();await pacer?.stop();pacer=null;continue;
    }
    const voiceSamples=[];let sampling=false;const voiceTimer=process.env.SCREENSH_TEST_CONCURRENT_VOICE==='1'?setInterval(async()=>{if(sampling)return;sampling=true;try{voiceSamples.push(await run('sampleVoiceLoad()'));}catch(error){console.error('VOICE_SAMPLE_FAILED',error.message);}finally{sampling=false;}},1000):null;
    let video;try{video=await run(`watchNoTunProbe(${httpPort},false,${publisher},${1-publisher})`);}finally{clearInterval(voiceTimer);}
    if(voiceSamples.length){
      console.log('CONCURRENT_VOICE_STATS',JSON.stringify({publisher,samples:voiceSamples}));
      // OBS startup can stall the main thread briefly. Check sustained playback
      // after ten seconds, rather than hiding recurring congestion in a mean.
      assertVoiceSamples(voiceSamples);
    }
    if(stress&&process.env.SCREENSH_TEST_WATCH_MS)await run("window.watchDurationMs=5000");const self=await run(`watchNoTunProbe(${httpPort},true,${publisher})`);assert.equal(video.width,stress?1920:640);assert.equal(self.width,stress?1920:640);if(stress&&process.env.SCREENSH_TEST_MOTION==='1'&&process.env.SCREENSH_TEST_EXTREME_NOISE!=='1'&&process.env.SCREENSH_TEST_PACER!=='0'){const stats=video.receiverStats,duration=video.samples.at(-1).t/1000;assert.ok(stats.framesDecoded>=duration*30*.85,'sustained decoded frame rate');assert.ok(stats.packetsLost<=3&&stats.nackCount<=10,'UDP loss and retransmission budget');assert.ok(stats.totalFreezesDuration<=1,'sustained freeze budget');}console.log('NO_TUN_SHARE_OK',JSON.stringify({publisher,video,self}));
    obs.stop();obs.shutdown();obs=null;await mtx.stop();if(pacer){console.log('MEDIA_PACER_STATS',JSON.stringify(pacer.stats()));await pacer.stop();pacer=null;}
  }
  if(process.env.SCREENSH_TEST_CONCURRENT_VOICE==='1')await run('stopVoiceLoad()');
}catch(error){console.error(error.stack);process.exitCode=1;}finally{await audioTiming.setActive(false);win?.destroy();if(obs){obs.stop();obs.shutdown();}await mtx.stop();await pacer?.stop();for(const transport of transports)await transport.stop();for(const forwarder of forwarders)await forwarder.clear();try{for(const context of nodes){const {stdout}=await require('node:util').promisify(require('node:child_process').execFile)(path.join(root,'res/easytier-cli.exe'),['-p',context.portal,'-n',context.instance,'-o','json','port-forward','list'],{windowsHide:true,timeout:8000});assert.deepEqual(JSON.parse(stdout).cfgs,[]);}console.log('NO_TUN_CLEANUP_OK');}catch(error){console.error('NO_TUN_CLEANUP_FAILED',error);process.exitCode=1;}await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const closed=once(child,'close');child.kill();await closed;}));clearTimeout(timeout);app.exit(process.exitCode||0);}});
