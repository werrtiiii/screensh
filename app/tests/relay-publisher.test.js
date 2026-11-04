const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createRelayPublisher,validateRelay}=require('../main/relay-publisher.cjs');
const descriptor={host:'10.126.126.1',port:8889,path:'relay-11111111-1111-4111-8111-111111111111',token:'a'.repeat(64)};
for(const noTun of [false,true])test(`native WHIP bridge authenticates and preserves session requests (${noTun?'no TUN':'TUN'})`,async t=>{
  const requests=[],operations=[];let badLocation=false;
  const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,auth:req.headers.authorization,method:req.method,body});
    if(req.method==='POST')res.writeHead(201,{'Content-Type':'application/sdp',Location:badLocation?'http://untrusted.invalid/stolen':`/${descriptor.path}/whip/22222222-2222-4222-8222-222222222222`}).end('v=0\r\na=candidate:1 1 udp 1 10.126.126.1 8189 typ host\r\na=candidate:2 1 udp 1 203.0.113.1 9999 typ host\r\n');else res.writeHead(204).end();});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const forwarder={open:ip=>{operations.push(['open',ip]);return {id:'scope'};},forward:async(_id,protocol,port)=>({host:'127.0.0.1',port:protocol==='tcp'?upstream.address().port:53000}),expose:async(_id,host,port)=>{assert.equal(host,'127.0.0.1');assert.equal(port,55000);return {port:42000};},close:async id=>operations.push(['close',id])};
  let stopped=0;const modes=[];const bridge=await createRelayPublisher({relay:descriptor,noTun,virtualIp:'10.144.0.2',forwarder,createPacer:options=>{modes.push(options.mode);assert.equal(options.targetPort,options.mode==='publish'?53000:30000);return {start:async()=>options.mode==='publish'?54000:55000,stop:async()=>{stopped++;}};}});
  t.after(async()=>{await bridge.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
  const response=await fetch(bridge.url,{method:'POST',headers:{'Content-Type':'application/sdp'},body:'v=0\r\na=candidate:1 1 udp 1 192.168.1.2 30000 typ host\r\n'});
  assert.equal(response.status,201);const answer=await response.text();assert.equal(answer.includes('203.0.113.1'),false);assert.ok(answer.includes('127.0.0.1 54000'));
  assert.equal(requests[0].auth,'Bearer '+descriptor.token);assert.equal(requests[0].url,`/${descriptor.path}/whip`);assert.ok(requests[0].body.includes(noTun?'10.144.0.2 42000':'192.168.1.2 30000'));
  const resource=new URL(response.headers.get('location'),bridge.url);assert.equal(resource.origin,new URL(bridge.url).origin);
  assert.equal((await fetch(resource,{method:'PATCH',headers:{'Content-Type':'application/trickle-ice-sdpfrag'},body:'a=ice-ufrag:test\r\n'})).status,204);
  assert.equal((await fetch(resource,{method:'DELETE'})).status,204);assert.equal(requests[2].auth,'Bearer '+descriptor.token);
  assert.equal((await fetch(new URL('/wrong/whip',bridge.url),{method:'POST'})).status,404);
  badLocation=true;assert.equal((await fetch(bridge.url,{method:'POST'})).status,502);
  await bridge.close();assert.deepEqual(operations.at(-1),['close','scope']);
  assert.equal(stopped,noTun?2:1,'all ICE paths have owned pacing and release it with the publisher');
  assert.deepEqual(modes,noTun?['receive','publish']:['publish']);
});
test('relay targets are restricted to virtual addresses and scoped stream paths',()=>{
  for(const change of [{host:'127.0.0.1'},{host:'example.com'},{path:'../admin'},{port:80},{token:'invalid'}])assert.throws(()=>validateRelay({...descriptor,...change}),/无效/);
});

test('direct WHIP preserves ICE candidates and credentials without using EasyTier or a pacer in no-TUN mode',async t=>{
  const offer='v=0\r\na=candidate:1 1 udp 1 192.168.1.2 30000 typ host\r\n',answer='v=0\r\na=candidate:2 1 udp 1 203.0.113.5 35686 typ host\r\n',requests=[];
  const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({method:req.method,body,auth:req.headers.authorization});if(req.method==='POST')res.writeHead(201,{'Content-Type':'application/sdp',Location:`/${descriptor.path}/whip/22222222-2222-4222-8222-222222222222`}).end(answer);else res.writeHead(204).end();});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const relay={...descriptor,transport:'direct',url:`http://127.0.0.1:${upstream.address().port}`,host:'127.0.0.1',port:upstream.address().port};
  const unexpected=()=>{throw Error('direct media must not enter EasyTier/pacing');};
  const bridge=await createRelayPublisher({relay,noTun:true,forwarder:{open:unexpected,forward:unexpected,close:unexpected},createPacer:unexpected});
  t.after(async()=>{await bridge.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
  const response=await fetch(bridge.url,{method:'POST',body:offer});assert.equal(response.status,201);assert.equal(await response.text(),answer);assert.equal(requests[0].body,offer);assert.equal(requests[0].auth,'Bearer '+relay.token);
  const resource=new URL(response.headers.get('location'),bridge.url);
  assert.equal((await fetch(resource,{method:'PATCH',body:'a=ice-ufrag:test\r\n'})).status,204);
  assert.equal((await fetch(resource,{method:'DELETE'})).status,204);
  assert.deepEqual(requests.map(r=>r.method),['POST','PATCH','DELETE']);
  for(const url of ['https://user:password@example.com','https://example.com/other','file:///tmp','https://example.com?token=secret'])assert.throws(()=>validateRelay({...relay,url}),/无效/);
});
