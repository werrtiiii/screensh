// Explicit native integration test. Captures only its own color window.
const {app,BrowserWindow}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const assert=require('node:assert/strict');
const {ObsEngine}=require(path.join(root,'main/obs-engine.js'));
const {allocateRpcPortal}=require(path.join(root,'main/member-routes.cjs'));
const hardware=process.env.SCREENSH_TEST_GPU!=='false';if(!hardware)app.disableHardwareAcceleration();
require(path.join(root,'main/realtime-policy.cjs')).configureRealtimeScheduling(app.commandLine);app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-background-timer-throttling');
const dir=path.join(root,'.runtime-probe','low-latency-'+Date.now());fs.mkdirSync(dir,{recursive:true});app.setPath('userData',path.join(dir,'profile'));app.on('window-all-closed',()=>{});
let win,fixture,captureSource,engine,mtx,log='';const results=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sampleSeconds=Math.min(240,Number(process.env.SCREENSH_TEST_BUFFER_SECONDS)||0);
const guard=setTimeout(()=>{console.error('LATENCY_PROBE_TIMEOUT');mtx?.kill();app.exit(1);},90000+sampleSeconds*1000);
app.whenReady().then(async()=>{try{
 const httpPort=Number((await allocateRpcPortal()).split(':').at(-1)),udpPort=Number((await allocateRpcPortal()).split(':').at(-1));
 const conf={logLevel:'warn',rtsp:false,rtmp:false,hls:false,srt:false,api:false,metrics:false,pprof:false,playback:false,webrtc:true,webrtcAddress:'127.0.0.1:'+httpPort,webrtcLocalUDPAddress:'127.0.0.1:'+udpPort,webrtcLocalTCPAddress:'127.0.0.1:'+udpPort,webrtcIPsFromInterfaces:false,webrtcAdditionalHosts:['127.0.0.1'],udpReadBufferSize:2097152,udpMaxPayloadSize:1200,paths:{live:{source:'publisher'}}};
 const config=path.join(dir,'mediamtx.json');fs.writeFileSync(config,JSON.stringify(conf));mtx=spawn(path.join(root,'res/mediamtx.exe'),[config],{windowsHide:true,env:{...process.env,MTX_MOQ:'false'},stdio:['ignore','pipe','pipe']});for(const s of [mtx.stdout,mtx.stderr])s.on('data',b=>log=(log+b).slice(-10000));
 for(let i=0;;i++){try{await fetch('http://127.0.0.1:'+httpPort,{signal:AbortSignal.timeout(300)});break;}catch{if(i>30)throw Error(log);await sleep(100);}}
 fixture=new BrowserWindow({show:false,width:720,height:480,title:'ScreenSh latency fixture',webPreferences:{backgroundThrottling:false}});await fixture.loadURL('data:text/html,<title>ScreenSh latency fixture</title><body style=%22margin:0;background:red%22></body>');fixture.showInactive();await sleep(400);engine=new ObsEngine(path.join(dir,'obs'),()=>{},'http://127.0.0.1:'+httpPort+'/live/whip',true);engine.init();captureSource=require(path.join(root,'main/capture-sources')).listCaptureSources(engine.osn,[]).find(s=>s.type==='window'&&s.name.includes('ScreenSh latency fixture'));if(!captureSource)throw Error('fixture unavailable');console.log('GPU_FEATURES',JSON.stringify(app.getGPUFeatureStatus()));console.log('ENCODERS',JSON.stringify(engine.osn.VideoEncoderFactory.types()));
 win=new BrowserWindow({show:false,width:720,height:480,webPreferences:{backgroundThrottling:false}});await win.loadFile(path.join(root,'tests/integration/smoke-player.html'));win.showInactive();
 for(const variant of [{fps:60,target:null}]){
 const shareAudio=process.env.SCREENSH_TEST_SHARE_AUDIO==='true';
 if(shareAudio)await fixture.webContents.executeJavaScript(`(async()=>{window.fixtureAudio=new AudioContext();const tone=fixtureAudio.createOscillator(),gain=fixtureAudio.createGain();gain.gain.value=0.0001;tone.connect(gain).connect(fixtureAudio.destination);tone.start();await fixtureAudio.resume();})()`,true);
 await fixture.webContents.executeJavaScript('document.body.style.background="red"');await engine.start({sourceType:'window',sourceId:captureSource.id,resolution:process.env.SCREENSH_TEST_RESOLUTION||'1280x720',frameRate:variant.fps,maxBitrate:Number(process.env.SCREENSH_TEST_BITRATE??4000),audioBitrate:128,videoEncoder:process.env.SCREENSH_TEST_ENCODER||'x264',shareAudio});
 const videoOnly=process.env.SCREENSH_TEST_VIDEO_ONLY==='true';
 await sleep(1200);await win.webContents.executeJavaScript(`(async()=>{const {WhepSession}=await import('../../renderer/whep.mjs');window.v=document.createElement('video');v.muted=true;v.autoplay=true;v.width=640;v.height=360;v.style='position:fixed;inset:0;width:100%;height:100%;background:black;z-index:2147483647';document.body.append(v);window.session=new WhepSession('http://127.0.0.1:${httpPort}/live/whep',{},e=>{v.srcObject??=new MediaStream();v.srcObject.addTrack(e.track);void v.play();},e=>console.error(e),{videoOnly:${videoOnly}});session.pc.addEventListener('track',e=>{if(${JSON.stringify(variant.target)}!==null&&'playoutDelayHint'in e.receiver)e.receiver.playoutDelayHint=0.001*${JSON.stringify(variant.target)};});await session.start();window.c=document.createElement('canvas');c.width=c.height=2;window.ctx=c.getContext('2d',{willReadFrequently:true});window.readColor=()=>{if(v.readyState<2)return null;ctx.drawImage(v,0,0,2,2);return [...ctx.getImageData(0,0,1,1).data];};})()`);
 for(let i=0;;i++){const color=await win.webContents.executeJavaScript('readColor()');if(color&&color[0]>150)break;if(i>100)throw Error('first frame unavailable '+log);await sleep(50);}
 await sleep(700);const delays=[];
 if(process.env.SCREENSH_TEST_ENCODER?.endsWith('-av1')){
   const codec=await win.webContents.executeJavaScript(`(async()=>{const report=await session.pc.getStats();const video=[...report.values()].find(row=>row.type==='inbound-rtp'&&row.kind==='video');return report.get(video?.codecId)?.mimeType;})()`);
   assert.equal(codec?.toLowerCase(),'video/av1','viewer receives AV1 rather than a codec substitution');
 }
 for(let i=0;i<10;i++){
 const blue=i%2===0;await win.webContents.executeJavaScript(`window.colorChanged=new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{const p=readColor();if(p&&p[${blue?2:0}]>170&&p[${blue?0:2}]<60){clearInterval(timer);resolve(Date.now());}else if(Date.now()-start>3000){clearInterval(timer);reject(Error('color timeout'));}},4);});void 0;`);
 const started=await fixture.webContents.executeJavaScript(`new Promise(resolve=>{document.body.style.background="${blue?"blue":"red"}";requestAnimationFrame(()=>resolve(Date.now()));})`);const changed=await win.webContents.executeJavaScript('colorChanged');if(i>1)delays.push(changed-started);await sleep(60);
 }
 if(process.env.SCREENSH_TEST_SUSTAINED==='true'){
   const sustained=await win.webContents.executeJavaScript(`(async()=>{const get=async()=>[...(await session.pc.getStats()).values()].find(row=>row.type==='inbound-rtp'&&row.kind==='video');const before=await get();await new Promise(resolve=>setTimeout(resolve,10000));const after=await get();return {frames:after.framesDecoded-before.framesDecoded,keyframes:after.keyFramesDecoded-before.keyFramesDecoded,lost:after.packetsLost-before.packetsLost};})()`);
   console.log('SUSTAINED_VIDEO',JSON.stringify(sustained));assert.ok(sustained.frames>=500,'continuous 60 FPS decoding');assert.ok(sustained.keyframes>=8,'one-second keyframes survive OBS output defaults');
 }
 if(sampleSeconds>0){
   const snapshot=()=>win.webContents.executeJavaScript(`(async()=>{const r=await session.pc.getStats();return Object.fromEntries([...r.values()].filter(s=>s.type==='inbound-rtp').map(s=>[s.kind,s.toJSON?.()??{...s}]));})()`);
   let previous=await snapshot();
   for(let seconds=0;seconds<sampleSeconds;){
     const interval=Math.min(10,sampleSeconds-seconds);
     await sleep(interval*1000);seconds+=interval;
     const current=await snapshot();const values={};
     for(const kind of ['video','audio']){
       const a=previous[kind],b=current[kind];if(!a||!b)continue;
       const emitted=b.jitterBufferEmittedCount-a.jitterBufferEmittedCount;
       const mean=key=>emitted>0&&Number.isFinite(a[key])&&Number.isFinite(b[key])?Math.round((b[key]-a[key])*1000/emitted):null;
       values[kind]={actual:mean('jitterBufferDelay'),target:mean('jitterBufferTargetDelay'),minimum:mean('jitterBufferMinimumDelay'),jitter:Math.round(b.jitter*1000),lost:b.packetsLost-a.packetsLost};
     }
     const avOffset=current.audio?.estimatedPlayoutTimestamp-current.video?.estimatedPlayoutTimestamp;
     console.log('BUFFER_SAMPLE',JSON.stringify({seconds,...values,avOffset:Number.isFinite(avOffset)?Math.round(avOffset):null}));previous=current;
   }
 }
 const stats=await win.webContents.executeJavaScript(`(async()=>{const r=await session.pc.getStats(),v=[...r.values()].find(s=>s.type==='inbound-rtp'&&s.kind==='video'),pair=r.get(r.get(v.transportId)?.selectedCandidatePairId),receiver=session.pc.getReceivers().find(r=>r.track.kind==='video');return {decoded:v.framesDecoded,decodeMs:v.totalDecodeTime*1000/v.framesDecoded,jitterBufferMs:v.jitterBufferDelay*1000/v.jitterBufferEmittedCount,targetMs:v.jitterBufferTargetDelay*1000/v.jitterBufferEmittedCount,rttMs:pair?.currentRoundTripTime*1000,decoder:v.decoderImplementation,powerEfficient:v.powerEfficientDecoder,targetApi:'jitterBufferTarget'in receiver,legacyApi:'playoutDelayHint'in receiver,actualTarget:receiver.playoutDelayHint,lost:v.packetsLost};})()`);
 assert.ok(stats.decoded>50,'continuous video decoding, not keyframes alone');const sorted=[...delays].sort((a,b)=>a-b);assert.ok(sorted.at(-1)<1000,'color changes cannot wait for the next periodic keyframe');const result={hardware,encoder:process.env.SCREENSH_TEST_ENCODER||'x264',shareAudio,...variant,colorToCanvasMs:{samples:delays,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1]},stats};result.native={frames:engine.streaming.totalFrames,fps:engine.osn.Global.currentFrameRate,lagged:engine.osn.Global.laggedFrames};result.actualWindowCapture=true;result.gpu=app.getGPUFeatureStatus();results.push(result);console.log('LATENCY_RESULT',JSON.stringify(result));await win.webContents.executeJavaScript('session.close().then(()=>{v.remove()})');await engine.stopAndWait();
 }
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));console.log('RESULT_FILE',path.join(dir,'results.json'));
}catch(e){console.error(e.stack,log);process.exitCode=1;}finally{clearTimeout(guard);win?.destroy();fixture?.destroy();await engine?.stopAndWait();engine?.shutdown();if(mtx&&mtx.exitCode===null){await new Promise(r=>{mtx.once('close',r);mtx.kill();});}app.exit(process.exitCode||0);}});
