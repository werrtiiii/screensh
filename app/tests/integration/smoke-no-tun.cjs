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
const network='routes-test-'+randomUUID();
async function start(ip,peers=[],listener,noTun=true){
  const portal=await allocateRpcPortal(),instance=randomUUID();
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('ET_')));
  const args=['-i',ip+(mixed?'/30':'/16'),'--no-tun',String(noTun),'--network-name',network,'--network-secret',network,'--instance-name',instance,'--rpc-portal',portal,'--bind-device','false','--disable-p2p','true','--disable-ipv6','true','--disable-upnp','--stun-servers','--stun-servers-v6'];
  if(!noTun)args.push('--dev-name',device);
  args.push(...(listener?['-l','tcp://'+listener]:['--no-listener']));if(peers.length)args.push('-p',...peers);
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
class SyntheticEngine extends ObsEngine{createSource(){return this.osn.InputFactory.create('color_source_v3','no-tun-color',{width:320,height:180,color:0xffff6600});}}
app.disableHardwareAcceleration();app.setPath('userData',path.join(root,'.runtime-probe/no-tun/profile'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let win,obs;const forwarders=[],transports=[],mtx=new ManagedProcess('No TUN MediaMTX');const timeout=setTimeout(()=>{console.error('NO_TUN_TIMEOUT');for(const child of children)if(child.exitCode===null)child.kill();mtx.stop();app.exit(1);},120000);try{
  assert.ok(!Object.values(require('node:os').networkInterfaces()).flat().some(row=>row?.address.startsWith('10.144.242.')),'test subnet must be unused');
  const listen=await allocateRpcPortal(),a=await start('10.144.242.1',[],listen,!mixed),b=await start('10.144.242.2',['tcp://'+listen]),c=mixed?null:await start('10.144.242.3',['tcp://'+listen]);await wait(a,result=>result.rows.some(row=>row.ip===(mixed?'10.144.242.2':'10.144.242.3')));
  if(mixed){const deadline=Date.now()+15000;while(!Object.values(require('node:os').networkInterfaces()).flat().some(row=>row?.address===a.context.virtualIp)){if(Date.now()>deadline)throw Error('TUN adapter not ready: '+a.tail());await new Promise(r=>setTimeout(r,100));}console.log('MIXED_TUN_ADAPTER_READY',device);}
  for(const node of [a,b,c].filter(Boolean))forwarders.push(createTunnelForwarder({exe:path.join(root,'res/easytier-cli.exe'),getContext:()=>node.context}));
  for(const [name,method] of [['openTunnelScope','open'],['forwardTunnelPort','forward'],['exposeTunnelPort','expose'],['closeTunnelScope','close']])ipcMain.handle(name,(_event,side,...args)=>forwarders[side][method](...args));
  const preload=path.join(root,'.runtime-probe/no-tun/preload.cjs');fs.writeFileSync(preload,'const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("network",Object.fromEntries(["openTunnelScope","forwardTunnelPort","exposeTunnelPort","closeTunnelScope"].map(key=>[key,(...args)=>ipcRenderer.invoke(key,...args)])));');
  win=new BrowserWindow({show:false,webPreferences:{preload,backgroundThrottling:false}});win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.log('NO_TUN_RENDERER',message);});await win.loadFile(path.join(__dirname,'no-tun-browser.html'));
  const run=code=>win.webContents.executeJavaScript(code,true);for(let i=0;i<100&&!await run('typeof voiceNoTunProbe==="function"');i++)await new Promise(r=>setTimeout(r,20));
  if(mixed)await run('window.testModes=[false,true];window.testPairs=[[0,1],[1,0]]');
  if(!process.env.SCREENSH_TEST_SKIP_VOICE){const voice=await run('voiceNoTunProbe()');console.log('NO_TUN_VOICE_OK',JSON.stringify(voice));}
  const serverId=randomUUID(),packets=[];for(const [index,node] of [a,b].entries()){const transport=new EasyTierLolPing({context:{serverId,channelId:'main',socketId:'peer-'+index,virtualIp:node.context.virtualIp,noTun:node.context.noTun},forwarder:forwarders[index],validEvent:()=>true,onPacket:packet=>packets.push({...packet,receiver:index}),onError:error=>console.error(error)});transports.push(transport);await transport.start();}
  transports[0].updatePeers([{socketId:'peer-1',channelId:'main',virtualIp:b.context.virtualIp,lolpingEndpoint:transports[1].endpoint}]);transports[1].updatePeers([{socketId:'peer-0',channelId:'main',virtualIp:a.context.virtualIp,lolpingEndpoint:transports[0].endpoint}]);
  for(let i=0;i<100&&new Set(packets.map(packet=>packet.receiver)).size<2;i++){transports.forEach(transport=>transport.send({kind:'ping',id:'normal',x:.5,y:.5,monitor:0}));await new Promise(r=>setTimeout(r,100));}if(new Set(packets.map(packet=>packet.receiver)).size<2)console.log('NO_TUN_LOLPING_STATE',JSON.stringify(transports.map(t=>({peers:[...t.peers.values()].map(p=>({ip:p.ip,port:p.port,sendPort:p.sendPort})),flows:[...t.forwardFlows],scopes:[...t.forwardScopes]}))));assert.equal(new Set(packets.map(packet=>packet.receiver)).size,2,'encrypted lolPing crosses no TUN forwards');console.log('NO_TUN_LOLPING_OK',packets.length);
  for(const publisher of mixed?[1,0]:[1]){
    const owner=[a,b][publisher].context,host=owner.noTun?'127.0.0.1':owner.virtualIp;
    const httpPort=Number((await allocateRpcPortal()).split(':')[1]),mediaPort=Number((await allocateRpcPortal()).split(':')[1]);
    await mtx.start(path.join(root,'res/mediamtx.exe'),[path.join(root,'mediamtx.yml')],{cwd:path.join(root,'res'),ready:log=>/\[WebRTC\] listener opened/.test(log),env:{...process.env,MTX_WEBRTCADDRESS:host+':'+httpPort,MTX_WEBRTCLOCALUDPADDRESS:host+':'+mediaPort,MTX_WEBRTCLOCALTCPADDRESS:host+':'+mediaPort,MTX_WEBRTCIPSFROMINTERFACES:'false',MTX_WEBRTCADDITIONALHOSTS:owner.virtualIp+(owner.noTun?',127.0.0.1':'')}});
    obs=new SyntheticEngine(path.join(root,'.runtime-probe/no-tun/obs'),undefined,'http://'+host+':'+httpPort+'/live/whip');obs.init();await obs.start({sourceId:'Auto',videoEncoder:'x264',resolution:'640x360',frameRate:10,maxBitrate:1000,audioBitrate:128,shareAudio:false});await mtx.waitForOutput(/\[path live\] stream is available/);
    const video=await run(`watchNoTunProbe(${httpPort},false,${publisher},${1-publisher})`),self=await run(`watchNoTunProbe(${httpPort},true,${publisher})`);assert.equal(video.width,640);assert.equal(self.width,640);console.log('NO_TUN_SHARE_OK',JSON.stringify({publisher,video,self}));
    obs.stop();obs.shutdown();obs=null;await mtx.stop();
  }
}catch(error){console.error(error.stack);process.exitCode=1;}finally{win?.destroy();if(obs){obs.stop();obs.shutdown();}await mtx.stop();for(const transport of transports)await transport.stop();for(const forwarder of forwarders)await forwarder.clear();try{for(const context of nodes){const {stdout}=await require('node:util').promisify(require('node:child_process').execFile)(path.join(root,'res/easytier-cli.exe'),['-p',context.portal,'-n',context.instance,'-o','json','port-forward','list'],{windowsHide:true,timeout:8000});assert.deepEqual(JSON.parse(stdout).cfgs,[]);}console.log('NO_TUN_CLEANUP_OK');}catch(error){console.error('NO_TUN_CLEANUP_FAILED',error);process.exitCode=1;}await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const closed=once(child,'close');child.kill();await closed;}));clearTimeout(timeout);app.exit(process.exitCode||0);}});
