const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTunnelForwarder}=require('../main/tunnel-forwarder.cjs');
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
