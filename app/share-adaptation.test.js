const { test } = require('node:test');
const assert = require('node:assert/strict');
const good={loss:0,buffer:30,rtt:80,jitter:5}, bad={loss:8,buffer:250,rtt:300,jitter:40};
async function fixture() {
  const {createShareAdaptation}=await import('./renderer/share-adaptation.mjs');let time=0;const changes=[];
  const base={resolution:'1920x1080',frameRate:60,maxBitrate:4000,audioBitrate:128};
  const controller=createShareAdaptation({base,width:1920,height:1080,bitrate:4000,now:()=>time,change:async(next,previous)=>{changes.push({next,previous});return true;}});
  return {controller,changes,base,feed:async(metrics,id='viewer')=>{time+=2000;await controller.report(id,metrics);}};
}
test('healthy networks, isolated loss and high RTT alone never lower configured quality',async()=>{
  const f=await fixture();for(let i=0;i<15;i++)await f.feed(good);
  await f.feed(bad);await f.feed(good);
  for(let i=0;i<10;i++)await f.feed({...good,rtt:1500,buffer:250});
  assert.equal(f.changes.length,0);assert.equal(f.controller.level,0);
});
test('sustained poor network lowers resolution and bitrate but preserves FPS/audio, then restores original quality',async()=>{
  const f=await fixture();for(let i=0;i<6;i++)await f.feed(bad);
  assert.equal(f.changes.length,1);assert.equal(f.changes[0].next.resolution,'1280x720');assert.equal(f.changes[0].next.frameRate,60);assert.equal(f.changes[0].next.audioBitrate,128);assert.ok(f.changes[0].next.maxBitrate<4000);
  for(let i=0;i<12;i++)await f.feed(good);
  assert.equal(f.controller.level,0);assert.deepEqual(f.changes.at(-1).next,f.base);
});
test('adaptation is bounded at 480p and closing prevents further changes',async()=>{
  const f=await fixture();for(let i=0;i<24;i++)await f.feed(bad);
  assert.equal(f.changes.length,2);assert.equal(f.changes.at(-1).next.resolution,'854x480');assert.equal(f.changes.at(-1).next.frameRate,60);
  f.controller.close();for(let i=0;i<20;i++)await f.feed(good);assert.equal(f.changes.length,2);
});
test('viewer samples reset after counter/stream replacement rather than fabricating packet loss',async()=>{
  const {sampleWatchNetwork}=await import('./renderer/share-adaptation.mjs');
  const report=(video)=>new Map([['video',{id:'v',type:'inbound-rtp',kind:'video',timestamp:1000,packetsReceived:100,packetsLost:0,jitterBufferDelay:1,jitterBufferEmittedCount:10,...video}]]);
  const first=sampleWatchNetwork(report({}));assert.equal(first.feedback,null);
  const next=sampleWatchNetwork(report({timestamp:3000,packetsReceived:148,packetsLost:2,jitterBufferDelay:1.1,jitterBufferEmittedCount:20}),first.snapshot);
  assert.equal(next.feedback.loss,4);assert.ok(Math.abs(next.feedback.buffer-10)<0.001);
  assert.equal(sampleWatchNetwork(report({id:'new'}),first.snapshot).feedback,null);
});
