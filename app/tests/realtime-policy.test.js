const {test}=require('node:test'),assert=require('node:assert/strict');
const {configureRealtimeScheduling}=require('../main/realtime-policy.cjs');
test('real-time scheduling retains caller feature switches and is idempotent',()=>{
  const switches=new Map([['disable-features','ExistingFeature']]);
  const cli={getSwitchValue:key=>switches.get(key)||'',appendSwitch:(key,value)=>switches.set(key,value)};
  configureRealtimeScheduling(cli);const first=switches.get('disable-features');configureRealtimeScheduling(cli);
  assert.equal(switches.get('disable-features'),first);assert.ok(first.startsWith('ExistingFeature,'));
  for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])assert.ok(switches.has(flag));
});
