// OBS's v5 control endpoint is simulated; the WHIP publisher, MediaMTX and
// Chromium WHEP decoder are real. Never connects to the user's OBS instance.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {mockObs}=require('../fixtures/obs-websocket.cjs');
const {ExternalObs}=require('../../main/external-obs.cjs');
const {ObsEngine}=require('../../main/obs-engine');
const {ManagedProcess}=require('../../main/managed-process');
const {createSignalingServer}=require('../../../server/server');
const root=path.resolve(__dirname,'../..'),data=path.join(root,'.runtime-probe','external-obs-'+process.pid);
app.disableHardwareAcceleration();app.setPath('userData',data);app.on('window-all-closed',()=>{});
class SyntheticEngine extends ObsEngine{createSource(){return this.osn.InputFactory.create('color_source_v3','external-obs-fixture',{width:640,height:360,color:0xff884422});}}
app.whenReady().then(async()=>{
  let win,endpoint,runtime,engine;let settings={port:4455,password:''},started=0,screenReads=0;const mtx=new ManagedProcess('External OBS MediaMTX');
  const {server,io}=createSignalingServer({initialPeers:'test.example:11010'});
  const timeout=setTimeout(()=>{console.error('EXTERNAL_OBS_TIMEOUT');app.exit(1);},90000);
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    settings.port=Number((await require('../../main/member-routes.cjs').allocateRpcPortal()).split(':').at(-1));
    endpoint=await mockObs({password:'fixture-password',onRequest:async(type,_request,state)=>{
      if(type==='StartStream'){
        engine=new SyntheticEngine(path.join(data,'obs'),undefined,state.service.streamServiceSettings.server,true);
        await engine.start({sourceId:0,sourceType:'screen',resolution:'640x360',frameRate:15,maxBitrate:1000,audioBitrate:128,shareAudio:false,videoEncoder:'x264'});state.active=true;return {};
      }
      if(type==='StopStream'){engine?.stop();engine?.shutdown();engine=null;state.active=false;return {};}
    }});
    const original=structuredClone(endpoint.state.service);
    runtime=new ExternalObs({getCredentials:()=>settings,onEnded:notice=>{win.webContents.send('share-ended',notice);}});
    for(const name of ['get-hardware-acceleration','get-login-startup'])ipcMain.handle(name,()=>false);
    ipcMain.handle('lolping-get',()=>({config:{enabled:false}}));ipcMain.handle('lolping-sync',()=>{});
    ipcMain.handle('start-easytier',()=> '10.144.1.1');ipcMain.handle('get-tunnel-mode',()=> 'tun');ipcMain.handle('leave-runtime',()=>{});ipcMain.handle('set-voice-timing',()=>{});
    ipcMain.handle('get-screens',()=>{screenReads++;return [{id:0,type:'screen',name:'测试屏幕'}];});
    ipcMain.handle('get-external-obs-settings',()=>({port:settings.port,hasPassword:!!settings.password}));
    ipcMain.handle('connect-external-obs',async(_event,input)=>{const next={...settings,...input},result=await runtime.inspect(next);settings=next;return result;});
    ipcMain.handle('inspect-external-obs',()=>runtime.inspect());
    const stop=async()=>{await runtime.stop();await mtx.stop();};
    ipcMain.handle('stop-sharing',stop);
    ipcMain.handle('start-sharing',async(_event,config)=>{
      assert.equal(config.sourceType,'obs');started++;
      await mtx.start(path.join(root,'res/mediamtx.exe'),[path.join(root,'mediamtx.yml')],{ready:log=>/\[WebRTC\] listener opened/.test(log),env:{...process.env,MTX_WEBRTCADDRESS:'127.0.0.1:8889',MTX_WEBRTCLOCALUDPADDRESS:'127.0.0.1:8189',MTX_WEBRTCLOCALTCPADDRESS:'127.0.0.1:8189',MTX_WEBRTCIPSFROMINTERFACES:'false',MTX_WEBRTCADDITIONALHOSTS:'127.0.0.1'}});
      const result=await runtime.start('http://127.0.0.1:8889/live/whip');await mtx.waitForOutput(/\[path live\] stream is available/);return result;
    });
    win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:path.join(root,'preload.js'),backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)console.error(message);});
    await win.loadFile(path.join(root,'renderer/index.html'));
    const run=code=>win.webContents.executeJavaScript(code,true);
    const wait=async(condition,ms=15000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await run(condition))return;await new Promise(resolve=>setTimeout(resolve,60));}throw Error('External OBS UI timeout: '+condition);};
    await run(`(async()=>{await import('./renderer.js');window.channelVoice.sync=()=>{};document.querySelector('#serverUrl').value='http://127.0.0.1:${server.address().port}';document.querySelector('#userName').value='OBS测试';document.querySelector('#btnConnect').click();})()`);
    await wait(`document.querySelector('#room').classList.contains('active')`);
    await run(`document.querySelector('#btnShare').click();document.querySelector('[data-source-tab="obs"]').click();`);
    await wait(`document.querySelector('.external-obs-status').textContent.includes('无法连接')`);
    await run(`document.querySelector('[name="obsPort"]').value='${endpoint.port}';document.querySelector('[name="obsPassword"]').value='wrong';document.querySelector('.external-obs-form').requestSubmit();`);
    await wait(`document.querySelector('.external-obs-status').textContent.includes('密码错误')`);
    assert.equal(await run(`document.querySelector('#btnConfirmShare').classList.contains('hidden')`),true);
    await run(`document.querySelector('[name="obsPassword"]').value='fixture-password';document.querySelector('.external-obs-form').requestSubmit();`);
    await wait(`!document.querySelector('#btnConfirmShare').classList.contains('hidden')`);
    assert.equal(await run(`document.querySelector('[name="obsPassword"]').value`),'');
    assert.equal(await run(`document.querySelector('.external-obs-scene').textContent`),'已配置的 OBS 场景');
    assert.equal(await run(`!document.querySelector('#screenPicker').classList.contains('hidden')`),true);
    await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await new Promise(resolve=>setTimeout(resolve,250));
    fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'external-obs-picker.png'),(await win.webContents.capturePage()).toPNG());
    // Selecting other tabs and returning must not leave a stale selection.
    await run(`document.querySelector('[data-source-tab="screen"]').click();`);await wait(`document.querySelector('.screen-item')?.textContent.includes('测试屏幕')`);
    await run(`document.querySelector('[data-source-tab="obs"]').click();`);await wait(`!document.querySelector('#btnConfirmShare').classList.contains('hidden')`);
    const readsBefore=screenReads;await run(`document.querySelector('#btnConfirmShare').click()`);
    await wait(`(async()=>{const {state}=await import('./shared.js');return state.isSharing;})()`);
    await run(`(async()=>{const {socket}=await import('./signaling.js');await (await import('./media.js')).displayRemoteVideo(socket.id);})()`);
    await wait(`document.querySelector('#videoContainer video')?.videoWidth===640`,25000);
    assert.equal(screenReads,readsBefore,'external publishing does not enumerate or start the internal capture engine');
    await run(`document.querySelector('#btnStopShare').click();`);await wait(`(async()=>!(await import('./shared.js')).state.stoppingShare)()`);
    assert.equal(endpoint.state.active,false);assert.deepEqual(endpoint.state.service,original);
    await run(`document.querySelector('#btnShare').click();`);await wait(`!document.querySelector('#btnConfirmShare').classList.contains('hidden')`);await run(`document.querySelector('#btnConfirmShare').click()`);await wait(`(async()=> (await import('./shared.js')).state.isSharing)()`);
    engine.stop();engine.shutdown();engine=null;endpoint.state.active=false;endpoint.event('StreamStateChanged',{outputActive:false,outputState:'OBS_WEBSOCKET_OUTPUT_STOPPED'});
    await wait(`(async()=>{const {state}=await import('./shared.js');return !state.isSharing&&!state.stoppingShare;})()`);assert.deepEqual(endpoint.state.service,original);
    assert.equal(await run(`document.querySelector('#room').classList.contains('active')`),true,'OBS stop must not disconnect voice or leave the server');
    assert.equal(started,2);console.log('EXTERNAL_OBS_OK',JSON.stringify({authentication:true,preview:true,actualWhip:true,actualWhepDecode:true,restoreOriginalSettings:true,manualObsStop:true,staysInServer:true,screenshot:path.join(data,'external-obs-picker.png')}));
  }catch(error){console.error(error.stack);process.exitCode=1;}
  finally{await runtime?.stop().catch(error=>console.error(error.message));engine?.stop();engine?.shutdown();await mtx.stop();win?.destroy();await endpoint?.close();await new Promise(resolve=>io.close(resolve));clearTimeout(timeout);app.exit(process.exitCode||0);}
});
