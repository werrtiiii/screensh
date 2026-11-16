const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {createInstallerLauncher}=require('../main/update-installer.cjs');
function fixture(t,behavior){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-installer-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const child=new EventEmitter();child.unref=()=>child.unreferenced=true;child.kill=()=>child.killed=true;
 const launch=createInstallerLauncher({pollMs:1,timeoutMs:100,spawnProcess:(command,args,options)=>{
  assert.equal(options.detached,true);assert.equal(options.windowsHide,true);assert.equal(options.stdio[0],'ignore');assert.equal(typeof options.stdio[1],'number');assert.equal(options.stdio[1],options.stdio[2]);
  const job=JSON.parse(fs.readFileSync(args[1],'utf8'));
  assert.equal(args[0],'--update');assert.equal(path.basename(command),'screensh-updater.exe');assert.equal(fs.existsSync(command),true);
  t.after(()=>fs.rmSync(options.cwd,{recursive:true,force:true}));
  behavior({child,job,options});return child;
 }});
 return {root,child,run:()=>launch({installer:path.join(root,'data/updates/pending/ScreenSh-9.0.0-Setup.exe'),sha512:'A'.repeat(86)+'==',version:'9.0.0',exe:path.join(root,'ScreenSh.exe'),directory:path.join(root,'data/temp')})};
}
test('installer waits for ready, keeps startup output and releases the parent reference',async t=>{
 const f=fixture(t,({job,options})=>{fs.writeSync(options.stdio[1],'startup diagnostic');setImmediate(()=>fs.writeFileSync(job.ready,'ready'));});
 assert.equal(await f.run(),true);assert.equal(f.child.unreferenced,true);
 const directory=path.join(f.root,'data/temp',fs.readdirSync(path.join(f.root,'data/temp'))[0]);assert.equal(fs.readFileSync(path.join(directory,'startup.log'),'utf8'),'startup diagnostic');
});
test('exit code zero before ready is a failed handoff, not successful installation',async t=>{
 const f=fixture(t,({child})=>setImmediate(()=>child.emit('exit',0)));await assert.rejects(f.run(),/未就绪.*退出码 0.*尚未安装更新.*startup.log/);assert.notEqual(f.child.unreferenced,true);
});
test('spawn errors retain the diagnostic path and never acknowledge readiness',async t=>{
 const f=fixture(t,({child})=>setImmediate(()=>child.emit('error',Error('spawn denied'))));await assert.rejects(f.run(),/spawn denied.*startup.log/);
});
test('startup timeout terminates only the unready child and leaves diagnostic files',async t=>{
 const f=fixture(t,()=>{});await assert.rejects(f.run(),/启动超时.*startup.log/);assert.equal(f.child.killed,true);assert.equal(fs.existsSync(path.join(f.root,'data/temp')),true);
});
