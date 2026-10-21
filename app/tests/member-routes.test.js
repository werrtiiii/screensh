const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parsePeerRows,createMemberRoutes}=require('../main/member-routes.cjs');
const output=JSON.stringify([
  {ipv4:'10.144.1.1',cost:'Local',tunnel_proto:'-'},
  {ipv4:'10.144.1.2',cost:'p2p',tunnel_proto:'tcp6,udp'},
  {ipv4:'10.144.1.3',cost:'relay(2)',tunnel_proto:''},
  {ipv4:'bad',cost:'p2p',tunnel_proto:'tcp'},
]);
test('member routes preserve local, direct, relay and actual IPv6 tunnel labels without inventing missing protocols',()=>{
  assert.deepEqual(parsePeerRows(output),[
    {ip:'10.144.1.1',route:'本机',protocol:'—'},
    {ip:'10.144.1.2',route:'p2p',protocol:'tcp6,udp'},
    {ip:'10.144.1.3',route:'relay(2)',protocol:'—'},
  ]);
  assert.throws(()=>parsePeerRows('{}'));
});
test('route queries target the owned portal and instance, coalesce reads and discard results from a departed network',async()=>{
  let context={portal:'127.0.0.1:23456',instance:'screensh-test'},now=0,calls=0,done;
  const reader=createMemberRoutes({exe:'easytier-cli.exe',getContext:()=>context,now:()=>now,execute:(exe,args,options,callback)=>{
    calls++;assert.equal(exe,'easytier-cli.exe');assert.deepEqual(args,['-p',context.portal,'-n',context.instance,'-o','json','peer','list']);assert.equal(options.windowsHide,true);assert.equal(options.timeout,2500);done=callback;
  }});
  const first=reader.read();assert.equal(reader.read(),first);done(null,output);assert.equal((await first).rows.length,3);
  assert.equal((await reader.read()).available,true);assert.equal(calls,1);
  now=3000;const pending=reader.read();context=null;done(null,output);assert.equal((await pending).available,false);assert.deepEqual(await reader.read(),{available:false,rows:[]});
  context={portal:'127.0.0.1:23457',instance:'screensh-next'};const failed=reader.read();done(Error('timeout'));assert.equal((await failed).available,false);
  now=6000;const malformed=reader.read();done(null,'not json');assert.equal((await malformed).available,false);
});
