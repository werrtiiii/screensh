const {test}=require('node:test'),assert=require('node:assert/strict');
const {mockObs}=require('./fixtures/obs-websocket.cjs');
const {ObsWebSocket}=require('../main/obs-websocket.cjs');
const {ExternalObs}=require('../main/external-obs.cjs');
const url='http://127.0.0.1:8889/live/whip';
test('OBS WebSocket authenticates using v5 challenge and rejects wrong passwords',async t=>{
  const server=await mockObs({password:'test-password'});t.after(()=>server.close());const bad=new ObsWebSocket({port:server.port,password:'wrong'});await assert.rejects(bad.connect(),/密码错误/);bad.close();
  const client=new ObsWebSocket({port:server.port,password:'test-password'});t.after(()=>client.close());await client.connect();assert.equal((await client.call('GetVersion')).obsVersion,'32.0.0');
});
test('external sharing configures WHIP, starts once, stops and restores the original OBS service',async t=>{
  const server=await mockObs();t.after(()=>server.close());const original=structuredClone(server.state.service),runtime=new ExternalObs({getCredentials:()=>({port:server.port})});t.after(()=>runtime.stop());
  const preview=await runtime.inspect();assert.equal(preview.scene,'已配置的 OBS 场景');assert.ok(preview.thumbnail.startsWith('data:image/png;'));assert.deepEqual(server.state.service,original);
  const result=await runtime.start(url);assert.equal(result.width,1280);assert.ok(result.externalObsSessionId);assert.equal(server.state.service.streamServiceType,'whip_custom');assert.equal(server.state.service.streamServiceSettings.server,url);assert.equal(server.state.active,true);
  await Promise.all([runtime.stop(),runtime.stop()]);assert.equal(server.state.active,false);assert.deepEqual(server.state.service,original);assert.equal(server.state.calls.filter(c=>c.type==='StartStream').length,1);assert.equal(server.state.calls.filter(c=>c.type==='StopStream').length,1);
});
test('existing OBS stream is never reconfigured or stopped',async t=>{
  const server=await mockObs();t.after(()=>server.close());server.state.active=true;const original=structuredClone(server.state.service),runtime=new ExternalObs({getCredentials:()=>({port:server.port})});
  await assert.rejects(runtime.start(url),/已在推流/);await runtime.stop();assert.equal(server.state.active,true);assert.deepEqual(server.state.service,original);assert.equal(server.state.calls.some(c=>['SetStreamServiceSettings','StopStream'].includes(c.type)),false);
});
test('stop during service configuration cancels startup and rolls back without starting a stream',async t=>{
  let release,reached;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{reached=resolve;});let held=false;
  const server=await mockObs({onRequest:async(type,data)=>{if(type==='SetStreamServiceSettings'&&data.streamServiceType==='whip_custom'&&!held){held=true;reached();await gate;}}});t.after(()=>server.close());const original=structuredClone(server.state.service),runtime=new ExternalObs({getCredentials:()=>({port:server.port})});
  const starting=runtime.start(url);const rejection=assert.rejects(starting,/取消/);await entered;const stopping=runtime.stop();release();await Promise.all([rejection,stopping]);assert.deepEqual(server.state.service,original);assert.equal(server.state.calls.some(c=>c.type==='StartStream'),false);
});
test('manual OBS stop ends only its own share and restores settings',async t=>{
  const server=await mockObs();t.after(()=>server.close());const notices=[],runtime=new ExternalObs({getCredentials:()=>({port:server.port}),onEnded:notice=>notices.push(notice)});t.after(()=>runtime.stop());const original=structuredClone(server.state.service),result=await runtime.start(url);
  server.state.active=false;server.event('StreamStateChanged',{outputActive:false,outputState:'OBS_WEBSOCKET_OUTPUT_STOPPED'});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(notices.length,1);assert.equal(notices[0].sessionId,result.externalObsSessionId);await runtime.stop();assert.deepEqual(server.state.service,original);
});
test('OBS settings encrypt passwords and never return plaintext through renderer settings',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-obs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'obs.json'),store=require('../main/external-obs-settings.cjs').createExternalObsSettings({file,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value.split('').reverse().join('')),decryptString:value=>value.toString().split('').reverse().join('')}});
  store.save({port:4455,password:'private-pass'});assert.deepEqual(store.get(),{port:4455,hasPassword:true});assert.equal(store.credentials().password,'private-pass');assert.ok(!fs.readFileSync(file,'utf8').includes('private-pass'));assert.equal(store.credentials({port:4456}).password,'private-pass');store.save({password:''});assert.equal(store.get().hasPassword,false);assert.throws(()=>store.credentials({port:80}));
});
test('failed OBS startup restores the previous service without stopping an unrelated stream',async t=>{
  const server=await mockObs({onRequest:type=>{if(type==='StartStream')throw Error('encoder unavailable');}});t.after(()=>server.close());
  const original=structuredClone(server.state.service),runtime=new ExternalObs({getCredentials:()=>({port:server.port})});
  await assert.rejects(runtime.start(url),/encoder unavailable/);await runtime.stop();
  assert.deepEqual(server.state.service,original);assert.equal(runtime.active,false);assert.equal(server.state.calls.some(c=>c.type==='StopStream'),false);
});
test('lost OBS control ends the share once and reconnects to stop and restore its own stream',async t=>{
  const server=await mockObs();t.after(()=>server.close());const notices=[],runtime=new ExternalObs({getCredentials:()=>({port:server.port}),onEnded:notice=>notices.push(notice)});
  const original=structuredClone(server.state.service),result=await runtime.start(url);
  for(const client of server.state.clients)client.terminate();
  const until=Date.now()+2000;while(!notices.length&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(notices.length,1);assert.equal(notices[0].sessionId,result.externalObsSessionId);
  await runtime.stop();assert.equal(server.state.active,false);assert.deepEqual(server.state.service,original);
});
test('failed restoration can be retried and never overwrites settings changed inside OBS',async t=>{
  let fail=true;const server=await mockObs({onRequest:(type,data)=>{if(type==='SetStreamServiceSettings'&&data.streamServiceType==='rtmp_custom'&&fail)throw Error('temporarily unavailable');}});t.after(()=>server.close());
  const original=structuredClone(server.state.service),runtime=new ExternalObs({getCredentials:()=>({port:server.port})});
  await runtime.start(url);await assert.rejects(runtime.stop(),/temporarily unavailable/);assert.equal(runtime.active,true);
  fail=false;await runtime.stop();assert.deepEqual(server.state.service,original);assert.equal(runtime.active,false);
  await runtime.start(url);server.state.service={streamServiceType:'rtmp_custom',streamServiceSettings:{server:'rtmp://changed.invalid'}};
  await runtime.stop();assert.equal(server.state.active,true);assert.equal(server.state.service.streamServiceSettings.server,'rtmp://changed.invalid');
});
test('unavailable OBS defers restoration to the same endpoint and refuses to replace an active stream',async t=>{
  const server=await mockObs(),other=await mockObs();t.after(()=>server.close());t.after(()=>other.close());let offline=false;
  const runtime=new ExternalObs({getCredentials:()=>({port:server.port}),clientFactory:options=>{const client=new ObsWebSocket(options);if(offline)client.connect=()=>Promise.reject(Error('offline'));return client;}});
  const original=structuredClone(server.state.service);await runtime.start(url);
  runtime.entry.client.close();offline=true;await runtime.stop();assert.equal(runtime.active,false);assert.equal(runtime.recoveries.size,1);
  offline=false;await runtime.inspect({port:other.port});assert.equal(runtime.recoveries.size,1);assert.equal(other.state.calls.some(c=>c.type==='SetStreamServiceSettings'),false);
  await assert.rejects(runtime.inspect(),/尚未停止/);server.state.active=false;await runtime.inspect();
  assert.deepEqual(server.state.service,original);assert.equal(runtime.recoveries.size,0);
});
