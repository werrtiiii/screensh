const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {createSetupFallback}=require('../main/setup-fallback.cjs');
function fixture(t,behavior,verifySignature=async()=>{}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-fallback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const pending=path.join(root,'data/updates/pending');fs.mkdirSync(pending,{recursive:true});const installer=path.join(pending,'ScreenSh-9.0.0-Setup.exe');fs.writeFileSync(installer,'MZ checked fixture');fs.writeFileSync(path.join(root,'data/profile'),'keep');
 const job={installer,version:'9.0.0',sha512:crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64'),exe:path.join(root,'ScreenSh.exe')};let child,stage;
 const launch=createSetupFallback({timeoutMs:30,pollMs:1,verifySignature:async file=>{stage=path.dirname(file);t.after(()=>fs.rmSync(stage,{recursive:true,force:true}));await verifySignature(file);},spawnProcess:(command,args,options)=>{stage=options.cwd;child=new EventEmitter();child.pid=123;child.kill=()=>child.killed=true;child.unref=()=>child.unreferenced=true;assert.equal(command,path.join(stage,'setup.exe'));assert.equal(options.detached,true);assert.equal(options.windowsVerbatimArguments,true);assert.equal(options.env.TEMP,stage);assert.equal(options.env.TMP,stage);assert.ok(args.includes('--screensh-wait-parent='+process.pid));assert.equal(args.at(-1),'/D='+root);behavior({child,stage});return child;}});
 return {job,root,launch,get child(){return child;},get stage(){return stage;}};
}
test('direct setup checks its copy and waits for NSIS acknowledgement outside the install root',async t=>{
 const f=fixture(t,({stage})=>setImmediate(()=>fs.writeFileSync(path.join(stage,'fallback.ready'),'ready')));assert.equal(await f.launch(f.job),true);assert.equal(f.child.unreferenced,true);assert.equal(fs.readFileSync(path.join(f.root,'data/profile'),'utf8'),'keep');
});
test('invalid checksum and invalid signatures cannot launch a setup',async t=>{
 const bad=fixture(t,()=>assert.fail('checksum failure must not launch'));await assert.rejects(bad.launch({...bad.job,sha512:'A'.repeat(86)+'=='}),/校验失败/);
 const signed=fixture(t,()=>assert.fail('signature failure must not launch'),async()=>{throw Error('signature invalid');});await assert.rejects(signed.launch(signed.job),/signature invalid/);
});
test('exit zero is not accepted without installer acknowledgement',async t=>{
 const f=fixture(t,({child})=>setImmediate(()=>child.emit('exit',0)));await assert.rejects(f.launch(f.job),/未就绪.*退出码 0/);assert.equal(fs.readFileSync(path.join(f.stage,'fallback.cancel'),'utf8'),'cancel');
});
test('timeout leaves a cancellation marker so a late elevated installer cannot apply later',async t=>{
 const f=fixture(t,()=>{});await assert.rejects(f.launch(f.job),/启动超时/);assert.equal(f.child.killed,true);assert.equal(fs.existsSync(path.join(f.stage,'fallback.cancel')),true);
});
