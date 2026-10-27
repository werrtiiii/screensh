const {test}=require('node:test'),assert=require('node:assert/strict');
const dgram=require('node:dgram');
const {createMemberProbe}=require('../main/member-probe.cjs');
async function fixture(t,{delay=0,silent=false,mapDelay=0}={}) {
  let context={virtualIp:'10.144.1.1',noTun:true};const server=dgram.createSocket('udp4');
  await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));let packets=0,maps=0,closes=0;
  server.on('message',(packet,remote)=>{packets++;if(silent)return;const reply=Buffer.from(packet);reply[8]=2;const send=()=>server.send(reply,remote.port,remote.address,()=>{});if(delay)setTimeout(send,delay);else send();});
  const forwarder={open:ip=>({id:ip}),forward:async()=>{maps++;if(mapDelay)await new Promise(resolve=>setTimeout(resolve,mapDelay));return {host:'127.0.0.1',port:server.address().port};},close:async()=>{closes++;}};
  const probe=createMemberProbe({getContext:()=>context,forwarder,port:0,bindHost:'127.0.0.2',timeout:150});await probe.start();
  t.after(async()=>{await probe.stop();server.close();});return {probe,server,forwarder,counts:()=>({packets,maps,closes}),disconnect:()=>{context=null;}};
}
test('UDP member probe measures round trip after mapping, deduplicates and caches requests',async t=>{
  const f=await fixture(t,{delay:20,mapDelay:100});const [a,b]=await Promise.all([f.probe.ping('10.144.1.2'),f.probe.ping('10.144.1.2')]);
  assert.deepEqual(a,b);assert.equal(a.source,'probe');assert.ok(a.rttMs>=15&&a.rttMs<100,JSON.stringify(a));
  assert.deepEqual(await f.probe.ping('10.144.1.2'),a);assert.deepEqual(f.counts(),{packets:1,maps:1,closes:0});
  await f.probe.stop();assert.equal(f.counts().closes,1);
});
test('silent peers time out; network departure cancels probes and invalidates cached replies',async t=>{
  const f=await fixture(t,{silent:true});assert.equal((await f.probe.ping('10.144.1.2')).rttMs,null);
  const pending=f.probe.ping('10.144.1.3');await new Promise(resolve=>setTimeout(resolve,10));await f.probe.stop();assert.equal((await pending).rttMs,null);
  f.disconnect();assert.equal((await f.probe.ping('10.144.1.2')).rttMs,null);await assert.rejects(f.probe.ping('8.8.8.8'),/无效/);
});
test('probe ignores spoofed nonces and releases failed mappings',async t=>{
  const f=await fixture(t,{silent:true});f.server.on('message',(packet,remote)=>{const wrong=Buffer.from(packet);wrong[8]=2;wrong[9]^=255;f.server.send(wrong,remote.port,remote.address);});
  assert.equal((await f.probe.ping('10.144.1.2')).rttMs,null);
  f.forwarder.forward=async()=>{throw Error('mapping failed');};assert.equal((await f.probe.ping('10.144.1.3')).rttMs,null);assert.equal(f.counts().closes,1);
});
