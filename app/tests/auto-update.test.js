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
test('startup gate checks and downloads before installation without background activity',async t=>{
 const {updates,client,counts}=fixture(t);updates.start();await new Promise(r=>setTimeout(r,20));assert.deepEqual(counts,{check:0,download:0});
 assert.deepEqual(await updates.prepareUpdate({automatic:true}),{install:true});assert.deepEqual(counts,{check:1,download:1});assert.equal(updates.get().status,'ready');
 assert.equal(client.autoDownload,false);assert.equal(client.autoInstallOnAppQuit,false);assert.equal(client.disableDifferentialDownload,false);
 await new Promise(r=>setTimeout(r,20));assert.deepEqual(counts,{check:1,download:1});
});

test('an already current version passes the startup gate without downloading',async t=>{
 const {updates,client,counts}=fixture(t);client.checkForUpdates=async()=>{counts.check++;return {isUpdateAvailable:false,updateInfo:{version:'1.5.2'}};};
 assert.deepEqual(await updates.prepareUpdate({automatic:true}),{enter:true});assert.deepEqual(counts,{check:1,download:0});
});

test('turning automatic update on saves preference but never downloads in the running main UI',async t=>{
 const {updates,counts}=fixture(t);updates.set(false);updates.set(true);await new Promise(r=>setTimeout(r,20));assert.deepEqual(counts,{check:0,download:0});
});

test('disabled preference survives restart and manual update remains available',async t=>{
  const {updates,args,counts}=fixture(t);updates.set(false);
  const restarted=createAutoUpdate(args);t.after(()=>restarted.stop());assert.equal(restarted.get().enabled,false);
  restarted.start();await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(counts,{check:0,download:0});
  await restarted.check();await restarted.download();assert.deepEqual(counts,{check:1,download:1});assert.equal(await restarted.restoreAtStartup(),false);
});
test('disabled startup updates enter immediately while a manual update remains available',async t=>{
 const {updates,counts}=fixture(t);updates.set(false);assert.deepEqual(await updates.prepareUpdate({automatic:true}),{enter:true});assert.deepEqual(counts,{check:0,download:0});
 assert.deepEqual(await updates.prepareUpdate(),{install:true});assert.deepEqual(counts,{check:1,download:1});
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
test('update progress reports changed-byte download size and identifies full-download fallback',async t=>{
  const {updates,client,events}=fixture(t);
  client.checkForUpdates=async()=>({isUpdateAvailable:true,updateInfo:{version:'9.0.0',files:[{url:'ScreenSh-9.0.0-Setup.exe',size:200000000}]}});
  await updates.check();
  client.emit('download-progress',{percent:50,total:4000000,transferred:2000000});
  assert.equal(events.at(-1).downloadMode,'differential');assert.equal(events.at(-1).total,4000000);assert.equal(events.at(-1).transferred,2000000);
  client.emit('download-progress',{percent:10,total:200000000,transferred:20000000});
  assert.equal(events.at(-1).downloadMode,'full');assert.equal(events.at(-1).total,200000000);
});

test('new checks wait for successful-startup cache cleanup rather than racing pending files',async t=>{
  let release;const pendingUpdates={confirmInstalled:()=>new Promise(resolve=>{release=resolve;}),remember(){},restore:async()=>null};
  const {updates,counts}=fixture(t,{pendingUpdates});const cleanup=updates.confirmStartup();await wait(()=>release);const checking=updates.check();assert.equal(counts.check,0);release(null);await cleanup;await checking;assert.equal(counts.check,1);
});

test('a failed installation never repeats silently on every startup and remains manually retryable',async t=>{
  let attempted=false,installs=0;
  const pendingUpdates={restore:async()=>({version:'9.0.0'}),markInstallAttempt(){attempted=true;},wasInstallAttempted:()=>attempted};
  const {updates,client,args,counts}=fixture(t,{pendingUpdates});
  client.quitAndInstall=()=>{installs++;client.quitAndInstallCalled=true;};
  assert.equal(await updates.restoreAtStartup(),true);assert.equal(updates.install(true,true),true);assert.equal(installs,1);
  const restarted=createAutoUpdate(args);t.after(()=>restarted.stop());
  assert.equal(await restarted.restoreAtStartup(),false);assert.equal(restarted.get().installFailed,true);assert.match(restarted.get().message,/上次自动更新未完成/);
  restarted.start();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(installs,1);assert.deepEqual(counts,{check:0,download:0});
  await restarted.download();assert.equal(restarted.install(false,true),true);assert.equal(installs,2);
});

test('a synchronous installer launch failure keeps normal startup available',async t=>{
  const {updates,client}=fixture(t,{pendingUpdates:{restore:async()=>({version:'9.0.0'}),markInstallAttempt(){}}});
  client.quitAndInstall=()=>{client.quitAndInstallCalled=false;};
  assert.equal(await updates.restoreAtStartup(),true);assert.equal(updates.install(true,true),false);assert.equal(updates.get().installFailed,true);
});
