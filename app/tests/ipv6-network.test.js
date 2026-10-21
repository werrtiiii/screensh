const {test}=require('node:test'),assert=require('node:assert/strict');
const {createIpv6Network}=require('../main/ipv6-network.cjs');
const snapshot=(extra={})=>({policyBlocked:false,adapters:[{name:'Wi-Fi',enabled:true,changed:false}],addresses:['2408:1234::2'],failures:[],...extra});
function fixture(value,extra={}){return createIpv6Network({platform:'win32',execute:(exe,args,options,done)=>{assert.match(exe,/WindowsPowerShell.*powershell\.exe$/);assert.ok(args.includes('-EncodedCommand'));assert.ok(!args.includes('-File'));const script=Buffer.from(args.at(-1),'base64').toString('utf16le');assert.match(script,/Get-NetAdapter -Physical/);assert.match(script,/\} -EnableIPv6$/);assert.equal(options.windowsHide,true);assert.equal(options.timeout,45000);done(null,JSON.stringify(value));},probe:async()=>true,...extra});}
test('IPv6 result distinguishes protocol binding, global address, reachability and EasyTier conflicts',async()=>{
  const success=await fixture(snapshot({adapters:[{name:'Wi-Fi',enabled:true,changed:true}]}),{getEasyTierDisabled:async()=>true}).run();assert.equal(success.code,'reachable');assert.match(success.message,/已启用/);assert.match(success.warnings[0],/EasyTier/);
  let probes=0;
  const noAddress=await fixture(snapshot({addresses:['fe80::1','fd00::1','::1']}),{probe:async()=>{probes++;return true;}}).run();assert.equal(noAddress.code,'no-address');assert.equal(probes,0);
  assert.equal((await fixture(snapshot(),{probe:async()=>false}).run()).code,'unconfirmed');
  assert.equal((await fixture(snapshot({policyBlocked:true})).run()).code,'policy-blocked');
  assert.equal((await fixture(snapshot({adapters:[]})).run()).code,'no-adapter');
  assert.equal((await fixture(snapshot({adapters:[{name:'Ethernet',enabled:false}]})).run()).code,'enable-failed');
});
test('IPv6 enable coalesces clicks, handles process errors and malformed output, and only probes from real global addresses',async()=>{
  let finish,calls=0;const network=createIpv6Network({platform:'win32',execute:(_exe,_args,_options,done)=>{calls++;finish=done;},probe:async(address,target)=>{assert.equal(address,'2408:1234::2');assert.ok(['2400:3200::1','2606:4700:4700::1111'].includes(target));return true;}});
  const first=network.run();assert.equal(network.run(),first);assert.equal(calls,1);finish(null,JSON.stringify(snapshot()));assert.equal((await first).code,'reachable');
  const failed=network.run();finish(Error('access denied'));await assert.rejects(failed,/管理员/);
  const invalid=network.run();finish(null,'wrong');await assert.rejects(invalid,/读取/);
  await assert.rejects(createIpv6Network({platform:'linux'}).run(),/Windows/);
});
