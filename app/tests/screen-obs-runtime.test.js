const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {ScreenObsRuntime}=require('../main/screen-obs-runtime.cjs');
function runtime(mode){return new ScreenObsRuntime(mode,()=>{},'http://127.0.0.1:8889/live/whip',true,{workerFile:path.join(__dirname,'fixtures/screen-obs-worker.cjs'),stopTimeoutMs:150,sourceTimeoutMs:150,startTimeoutMs:3000,idleMs:30000});}
test('blocked native stop cannot freeze the parent and the owned worker can restart',async()=>{
  const obs=runtime('block-stop');let beats=0;const heartbeat=setInterval(()=>beats++,10);
  try{await obs.start({});const previous=obs.worker.pid,started=Date.now();const stop=obs.stopAndWait();assert.equal(obs.stopAndWait(),stop);await stop;assert.ok(Date.now()-started<3500);assert.ok(beats>3,'parent event loop keeps running during native hang');assert.equal(obs.worker,null);assert.equal(obs.streaming,false);await obs.start({});assert.notEqual(obs.worker.pid,previous);}finally{clearInterval(heartbeat);await obs.shutdown();}
});
test('blocked source enumeration times out, resets only its worker and allows subsequent capture',async()=>{
  const obs=runtime('block-sources');let beats=0;const heartbeat=setInterval(()=>beats++,10);
  try{await assert.rejects(obs.sources([]),/超时/);assert.ok(beats>3);assert.equal(obs.worker,null);await obs.start({});assert.equal(obs.streaming,true);await obs.stopAndWait();assert.equal(obs.streaming,false);}finally{clearInterval(heartbeat);await obs.shutdown();}
});

test('idle native cleanup cannot freeze the parent when switching to external OBS',async()=>{
  const obs=runtime('block-idle');obs.options.idleMs=50;let beats=0;const heartbeat=setInterval(()=>beats++,10);
  try{await obs.sources([]);const until=Date.now()+2500;while(obs.worker&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(obs.worker,null);assert.ok(beats>5);}finally{clearInterval(heartbeat);await obs.shutdown();}
});
