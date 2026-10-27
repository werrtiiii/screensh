const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createAutoUpdate} = require('../main/auto-update.cjs');
const wait = async condition => {const end=Date.now()+2000;while(!condition()){if(Date.now()>end)throw Error('update test timeout');await new Promise(resolve=>setTimeout(resolve,5));}};
function fixture(t, options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-update-')),file=path.join(dir,'settings.json');
  const client = new EventEmitter(), counts={check:0, download:0}, events=[];
  client.checkForUpdates = async () => {counts.check++;return {isUpdateAvailable:true,updateInfo:{version:'9.0.0'}};};
  client.downloadUpdate = async () => {counts.download++;client.emit('download-progress',{percent:55});client.emit('update-downloaded',{version:'9.0.0'});};
  let saved=null;
  const pendingUpdates={remember:(_client,info)=>{saved={version:info.version};},restore:async()=>saved};
  const args={file,packaged:true,currentVersion:'1.5.2',getUpdater:()=>client,send:state=>events.push(state),startupMs:0,intervalMs:100000,pendingUpdates,...options};
  const updates=createAutoUpdate(args);t.after(()=>{updates.stop();fs.rmSync(dir,{recursive:true,force:true});});
  return {updates, client, counts, events, args};
}
test('automatic downloads become installable only through the startup restore path',async t=>{
  const {updates,client,counts,events,args}=fixture(t);assert.equal(updates.get().enabled,true);assert.equal(await updates.restoreAtStartup(),false);
  updates.start();await wait(()=>updates.get().status==='ready');
  assert.deepEqual(counts,{check:1,download:1});
  assert.equal(client.autoDownload,false);assert.equal(client.autoInstallOnAppQuit,false);
  assert.ok(events.some(state=>state.status==='downloading'&&state.percent===55));
  updates.stop();const restarted=createAutoUpdate(args);t.after(()=>restarted.stop());
  assert.equal(await restarted.restoreAtStartup(),true);assert.deepEqual(counts,{check:1,download:1},'restoring a local download makes no network requests');
  assert.equal(updates.set(false),false);assert.equal(await updates.restoreAtStartup(),false);
});
test('disabled preference survives restart and manual update remains available',async t=>{
  const {updates,args,counts}=fixture(t);updates.set(false);
  const restarted=createAutoUpdate(args);t.after(()=>restarted.stop());assert.equal(restarted.get().enabled,false);
  restarted.start();await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(counts,{check:0,download:0});
  await restarted.check();await restarted.download();assert.deepEqual(counts,{check:1,download:1});assert.equal(await restarted.restoreAtStartup(),false);
});
test('turning auto update off during a check prevents its automatic download',async t=>{
  const {updates,client,counts}=fixture(t);let release;
  client.checkForUpdates=()=>{counts.check++;return new Promise(resolve=>{release=resolve;});};
  updates.start();await wait(()=>release);updates.set(false);release({isUpdateAvailable:true,updateInfo:{version:'9.0.0'}});
  await wait(()=>updates.get().status==='available');assert.equal(counts.download,0);
});
test('concurrent checks and downloads are shared and failures can be retried',async t=>{
  const {updates,client,counts}=fixture(t);await Promise.all([updates.check(),updates.check()]);assert.equal(counts.check,1);
  client.downloadUpdate=async()=>{counts.download++;throw Error('offline');};
  await assert.rejects(Promise.all([updates.download(),updates.download()]),/下载更新失败/);assert.equal(counts.download,1);assert.equal(await updates.restoreAtStartup(),false);
  client.downloadUpdate=async()=>{counts.download++;client.emit('update-downloaded',{version:'9.0.0'});};
  await updates.download();assert.equal(counts.download,2);assert.equal(await updates.restoreAtStartup(),true);
});
test('development mode does not check or download automatically',async t=>{
  const {updates,counts}=fixture(t,{packaged:false});updates.start();updates.set(true);
  assert.equal((await updates.check()).development,true);assert.deepEqual(counts,{check:0,download:0});await assert.rejects(updates.download(),/开发模式/);
});
test('invalid cached update reports an error and lets normal startup continue',async t=>{
  const {updates,counts}=fixture(t,{pendingUpdates:{remember(){},restore:async()=>{throw Error('缓存校验失败');}}});
  assert.equal(await updates.restoreAtStartup(),false);assert.equal(updates.get().status,'error');assert.match(updates.get().message,/校验失败/);
  assert.deepEqual(counts,{check:0,download:0});
});
