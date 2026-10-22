const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTunnelForwarder}=require('../main/tunnel-forwarder.cjs');

test('browser media relay forwards a burst without enumerating Windows adapters per packet',async t=>{
  const dgram=require('node:dgram'),os=require('node:os'),{once}=require('node:events');
  const original=os.networkInterfaces,interfaces=original();let enumerations=0;
  const host=Object.values(interfaces).flat().find(row=>row?.family==='IPv4'&&!row.internal&&!row.address.startsWith('169.254.'))?.address;
  if(!host){t.skip('requires a local IPv4 interface');return;}
  t.mock.method(os,'networkInterfaces',()=>{enumerations++;return interfaces;});
  const backend=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024}),client=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024});
  const context={noTun:true,virtualIp:'10.144.1.1'},forwarder=createTunnelForwarder({exe:'unused',getContext:()=>context});
  t.after(async()=>{await forwarder.clear();backend.close();client.close();});
  backend.bind(0,'127.0.0.1');await once(backend,'listening');client.bind(0,host);await once(client,'listening');
  backend.on('message',(bytes,remote)=>backend.send(bytes,remote.port,remote.address));
  const scope=forwarder.open(context.virtualIp),target=await forwarder.forward(scope.id,'udp',backend.address().port),before=enumerations;
  const seen=new Set(),count=200;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`browser burst received ${seen.size}/${count}`)),3000);client.on('message',bytes=>{seen.add(bytes.readUInt32LE());if(seen.size===count){clearTimeout(timer);resolve();}});for(let i=0;i<count;i++){const bytes=Buffer.alloc(1200);bytes.writeUInt32LE(i);client.send(bytes,target.port,target.host);}});
  assert.equal(enumerations,before,'packet forwarding must not synchronously enumerate adapters');
});
test('media ingress preserves a keyframe-sized UDP burst through the local bridge',async t=>{
  const dgram=require('node:dgram'),{once}=require('node:events');
  const backend=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024}),client=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024});
  const context={noTun:true},forwarder=createTunnelForwarder({exe:'unused',getContext:()=>context}),scope=forwarder.open('10.144.1.2');
  t.after(async()=>{await forwarder.clear();backend.close();client.close();});
  backend.bind(0,'127.0.0.1');await once(backend,'listening');client.bind(0,'127.0.0.1');await once(client,'listening');
  const exposed=await forwarder.expose(scope.id,'127.0.0.1',backend.address().port),count=200;
  backend.on('message',(_request,remote)=>{for(let i=0;i<count;i++){const bytes=Buffer.alloc(1200);bytes.writeUInt32LE(i);backend.send(bytes,remote.port,remote.address);}});
  const seen=new Set();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`lost local UDP burst packets: ${seen.size}/${count}`)),3000);client.on('message',bytes=>{seen.add(bytes.readUInt32LE());if(seen.size===count){clearTimeout(timer);resolve();}});client.send(Buffer.from('request'),exposed.port,'127.0.0.1');});
  assert.equal(seen.size,count);
});
test('forward scopes validate targets, isolate mappings, deduplicate requests and remove active rules',async()=>{
  const context={portal:'127.0.0.1:30000',instance:'owned',noTun:true},calls=[];
  const forwarder=createTunnelForwarder({exe:'cli',getContext:()=>context,execute:(_exe,args,options,done)=>{assert.equal(options.windowsHide,true);calls.push(args);setImmediate(()=>done(null,''));}});
  assert.throws(()=>forwarder.open('127.0.0.1'));const scope=forwarder.open('10.144.1.2');
  await assert.rejects(forwarder.forward(scope.id,'tcp',22));await assert.rejects(forwarder.forward(scope.id,'bad',8889));await assert.rejects(forwarder.expose(scope.id,'8.8.8.8',8889));
  const [a,b]=await Promise.all([forwarder.forward(scope.id,'tcp',8889),forwarder.forward(scope.id,'tcp',8889)]);assert.deepEqual(a,b);assert.equal(calls.filter(args=>args.includes('add')&&args.at(-1).endsWith(':8889')).length,1);assert.equal(a.host,'127.0.0.1');
  await forwarder.close(scope.id);assert.ok(calls.some(args=>args.includes('remove')));await assert.rejects(forwarder.forward(scope.id,'tcp',8889),/关闭/);
  const next=forwarder.open('10.144.1.2');await forwarder.forward(next.id,'tcp',8890);assert.equal(calls.filter(args=>args.includes('add')&&args.at(-1).endsWith(':9')).length,1,'keep stack alive across channel changes');
  await forwarder.clear();assert.ok(calls.some(args=>args.includes('remove')&&args.at(-1).endsWith(':9')));
});
test('cancelled or stale pending forwards cannot become live after cleanup',async()=>{
  const context={portal:'127.0.0.1:30000',instance:'owned',noTun:true};let release;const calls=[];
  const forwarder=createTunnelForwarder({exe:'cli',getContext:()=>context,execute:(_exe,args,_options,done)=>{calls.push(args);if(args.includes('add')&&args.at(-1).endsWith(':8889'))release=done;else done(null,'');}}),scope=forwarder.open('10.144.1.2');
  const pending=forwarder.forward(scope.id,'tcp',8889);while(!release)await new Promise(resolve=>setImmediate(resolve));const closed=forwarder.close(scope.id);release(null,'');await assert.rejects(pending,/关闭/);await closed;assert.ok(calls.some(args=>args.includes('remove')));
});
