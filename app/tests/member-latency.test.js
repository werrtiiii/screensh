const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMemberLatency}=require('../main/member-latency.cjs');
const ip='10.144.1.2';
function fixture(noTun=false){
  let context={noTun};const calls=[];
  const probe={ping:async()=>{calls.push('probe');return {ip,rttMs:null};}};
  const pinger={ping:async()=>{calls.push('icmp');return {ip,rttMs:null};}};
  const routes={read:async()=>{calls.push('routes');return {available:true,rows:[{ip,route:'p2p',rttMs:40}]};}};
  const latency=createMemberLatency({getContext:()=>context,probe,pinger,routes});
  return {latency,probe,pinger,routes,calls,change:()=>{context={noTun};},disconnect:()=>{context=null;}};
}
for(const noTun of [false,true])test(`UDP end-to-end RTT wins over tunnel RTT in ${noTun?'no TUN':'TUN'} mode`,async()=>{
  const f=fixture(noTun);f.probe.ping=async()=>{f.calls.push('probe');return {ip,rttMs:61};};
  assert.deepEqual(await f.latency.ping(ip),{ip,rttMs:61,noTun,source:'probe'});
  assert.deepEqual(f.calls,['probe']);
});
test('TUN compatibility falls back to ICMP then to the direct tunnel when ICMP fails',async()=>{
  const f=fixture();f.pinger.ping=async()=>{f.calls.push('icmp');return {ip,rttMs:24};};
  assert.equal((await f.latency.ping(ip)).source,'icmp');assert.deepEqual(f.calls,['probe','icmp']);
  f.calls.length=0;f.pinger.ping=async()=>{f.calls.push('icmp');throw Error('blocked');};
  assert.equal((await f.latency.ping(ip)).source,'tunnel');assert.deepEqual(f.calls,['probe','icmp','routes']);
});
test('no TUN skips system ICMP and uses a direct tunnel reference only after probing',async()=>{
  const f=fixture(true);assert.equal((await f.latency.ping(ip)).source,'tunnel');assert.deepEqual(f.calls,['probe','routes']);
  f.routes.read=async()=>({available:true,rows:[{ip,route:'relay(2)',rttMs:40}]});
  assert.equal((await f.latency.ping(ip)).rttMs,null);
});
test('wrong-target and invalid samples never become successful measurements',async()=>{
  const f=fixture();f.probe.ping=async()=>({ip:'10.144.1.3',rttMs:10});f.pinger.ping=async()=>({ip,rttMs:-1});
  f.routes.read=async()=>({available:false,rows:[{ip,route:'p2p',rttMs:40}]});
  assert.equal((await f.latency.ping(ip)).source,'unavailable');
  for(const value of ['127.0.0.1','example.com','10.144.1.2 & whoami',null])await assert.rejects(f.latency.ping(value),/无效/);
});
test('leaving or replacing a network discards in-flight measurements and stops fallbacks',async()=>{
  for(const change of ['change','disconnect']){
    const f=fixture();f.probe.ping=async()=>{f[change]();return {ip,rttMs:10};};
    assert.equal((await f.latency.ping(ip)).rttMs,null);assert.deepEqual(f.calls,[]);
  }
  const f=fixture();f.disconnect();assert.equal((await f.latency.ping(ip)).rttMs,null);assert.deepEqual(f.calls,[]);
});
