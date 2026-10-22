const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAudioTiming}=require('../main/audio-timing.cjs');
test('audio timing applies only to app-owned PIDs, retains original state and restores on stop',async()=>{
  const calls=[];let processes=[{pid:11},{pid:12}];
  const timing=createAudioTiming({exe:'helper',platform:'win32',getProcesses:()=>processes,execute:(_exe,args,options,done)=>{
    assert.equal(options.windowsHide,true);calls.push(args);
    done(null,args[1]==='apply'?args.slice(2).map(pid=>JSON.stringify({pid:Number(pid),created:'123456789012345678',control:0,state:0,applied:true})).join('\n'):'');
  }});
  await timing.setActive(true);await timing.setActive(true);assert.equal(calls.length,1);
  processes.push({pid:13});await timing.setActive(true);assert.deepEqual(calls[1],['--audio-policy','apply','13']);
  await timing.setActive(false);assert.deepEqual(calls[2],['--audio-policy','restore','11:123456789012345678:0:0','12:123456789012345678:0:0','13:123456789012345678:0:0']);
  await timing.setActive(false);assert.equal(calls.length,3);
});
test('stopping while apply is in flight waits and restores the newly applied state',async()=>{
  let finish;const calls=[];
  const timing=createAudioTiming({exe:'helper',platform:'win32',getProcesses:()=>[{pid:21}],execute:(_exe,args,_options,done)=>{calls.push(args);if(args[1]==='apply')finish=()=>done(null,JSON.stringify({pid:21,created:'42',control:1,state:1,applied:true}));else done(null,'');}});
  const start=timing.setActive(true);while(!finish)await new Promise(resolve=>setImmediate(resolve));const stop=timing.setActive(false);finish();await Promise.all([start,stop]);assert.equal(calls[1][1],'restore');assert.equal(calls[1][2],'21:42:1:1');
});
test('unsupported platforms do not run native helpers',async()=>{
  const timing=createAudioTiming({platform:'linux',getProcesses:()=>{throw Error('must not enumerate');}});await timing.setActive(true);await timing.setActive(false);
});
