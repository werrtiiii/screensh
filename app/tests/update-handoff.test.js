const {test}=require('node:test'),assert=require('node:assert/strict');
const {createUpdateHandoff}=require('../main/update-handoff.cjs');
const job={installer:'update.json',version:'9.0.0',exe:'ScreenSh.exe'};
const startupError=()=>Object.assign(Error('startup failed'),{code:'INSTALLER_HANDOFF_FAILED',canFallback:true});
test('successful independent handoff never prepares or downloads a full installer',async()=>{
 const calls=[];await createUpdateHandoff({launch:async()=>calls.push('launch'),prepareSetup:async()=>assert.fail('unexpected full download'),launchSetup:async()=>assert.fail('unexpected setup'),quit:async()=>calls.push('quit')})(job);assert.deepEqual(calls,['launch','quit']);
});
test('fallback waits for the installer readiness before quitting and keeps the version',async()=>{
 const calls=[];let acknowledge;const task=createUpdateHandoff({launch:async()=>{throw startupError();},prepareSetup:async version=>{assert.equal(version,job.version);calls.push('prepare');return {installer:'setup.exe'};},launchSetup:async value=>{assert.equal(value.installer,'setup.exe');assert.equal(value.exe,job.exe);calls.push('setup');await new Promise(resolve=>acknowledge=resolve);},quit:async()=>calls.push('quit')})(job);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['prepare','setup']);acknowledge();await task;assert.deepEqual(calls,['prepare','setup','quit']);
});
test('invalid jobs and an unconfirmed old worker exit never trigger a second installer',async()=>{
 for(const error of [Error('invalid checksum'),Object.assign(startupError(),{canFallback:false})])await assert.rejects(createUpdateHandoff({launch:async()=>{throw error;},prepareSetup:async()=>assert.fail('unsafe fallback'),quit:async()=>assert.fail('unsafe quit')})(job));
});
test('fallback download and setup failures preserve the running app',async()=>{
 for(const at of ['download','setup'])await assert.rejects(createUpdateHandoff({launch:async()=>{throw startupError();},prepareSetup:async()=>{if(at==='download')throw Error('offline');return job;},launchSetup:async()=>{throw Error('setup denied');},quit:async()=>assert.fail('must keep running')})(job),/当前软件已保留/);
});
