const {test}=require('node:test');
const assert=require('node:assert/strict');
test('channel preferences default on, fall back to main from outside and stay local to each server',async t=>{
  const values=new Map(),original=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  t.after(()=>{if(original)globalThis.localStorage=original;else delete globalThis.localStorage;});
  const {readChannelPreferences,saveChannelPreference,preferredChannel,joinPreferredChannel}=await import('../renderer/server-channel-preferences.mjs');
  assert.deepEqual(readChannelPreferences('a'),{autoJoin:true,lastChannel:'main'});
  saveChannelPreference('a',{lastChannel:'music'});assert.equal(preferredChannel('a'),'music');
  saveChannelPreference('a',{autoJoin:false});assert.equal(preferredChannel('a'),null);assert.equal(preferredChannel('b'),'main');
  saveChannelPreference('a',{autoJoin:true});assert.equal(preferredChannel('a'),'music');
  saveChannelPreference('a',{lastChannel:null});assert.equal(preferredChannel('a'),'main');
  saveChannelPreference('a',{lastChannel:'music'});
  const attempts=[];
  const result=await joinPreferredChannel('a',{userName:'User'},async payload=>{attempts.push(payload);if(payload.channelId==='music')throw Error('无法进入该频道');return {ok:true};});
  assert.deepEqual(attempts.map(item=>item.channelId),['music','main']);assert.equal(result.ok,true);
  let calls=0;await assert.rejects(joinPreferredChannel('a',{},async()=>{calls++;throw Error('服务器密码错误');}),/密码/);assert.equal(calls,1);
});
