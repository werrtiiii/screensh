const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {cleanupTransactions}=require('../main/update-cleanup.cjs');
const {cleanupFallbackStages}=require('../main/update-cleanup.cjs');
const {confirmPortableStartup}=require('../main/portable-confirm.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'update-backup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let i=0;return {root,transaction(phase,version='9.0.0'){
  const id='12345678-1234-1234-1234-'+String(++i).padStart(12,'0'),directory=path.join(root,'data/updates/transactions',id);
  fs.mkdirSync(path.join(directory,'backup'),{recursive:true});fs.writeFileSync(path.join(directory,'backup/old.dll'),'old');fs.writeFileSync(path.join(directory,'journal.json'),JSON.stringify({root,phase,version}));return {id,directory};
}};}
test('fallback copies are removed only after matching startup or an expired cancellation',async t=>{
 const f=fixture(t),temp=path.join(f.root,'temp'),receipts=path.join(f.root,'data/updates/fallback-stages');fs.mkdirSync(receipts,{recursive:true});let i=0;
 function stage(version,cancelled=false,created=0){const name='ScreenSh-fallback-12345678-1234-1234-1234-'+String(++i).padStart(12,'0'),directory=path.join(temp,name);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'setup.exe'),'payload');if(cancelled)fs.writeFileSync(path.join(directory,'fallback.cancel'),'cancel');fs.writeFileSync(path.join(receipts,name+'.json'),JSON.stringify({stage:directory,version,root:f.root,created}));return directory;}
 const installed=stage('9.0.0'),future=stage('10.0.0'),cancelled=stage('10.0.0',true),fresh=stage('10.0.0',true,999999);
 await cleanupFallbackStages(f.root,'9.0.0',{temp,now:1000000});assert.equal(fs.existsSync(installed),false);assert.equal(fs.existsSync(cancelled),false);assert.equal(fs.existsSync(future),true);assert.equal(fs.existsSync(fresh),true);
});
test('fallback cleanup rejects paths outside its temporary namespace',async t=>{
 const f=fixture(t),temp=path.join(f.root,'temp'),receipts=path.join(f.root,'data/updates/fallback-stages'),outside=path.join(f.root,'keep');fs.mkdirSync(receipts,{recursive:true});fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'data'),'keep');
 fs.writeFileSync(path.join(receipts,'ScreenSh-fallback-12345678-1234-1234-1234-123456789abc.json'),JSON.stringify({stage:outside,root:f.root,version:'9.0.0'}));await cleanupFallbackStages(f.root,'9.0.0',{temp});assert.equal(fs.readFileSync(path.join(outside,'data'),'utf8'),'keep');
});
test('busy fallback executables keep their cancellation marker and receipt for later cleanup',async t=>{
 const f=fixture(t),temp=path.join(f.root,'temp'),name='ScreenSh-fallback-12345678-1234-1234-1234-123456789abc',stage=path.join(temp,name),receipts=path.join(f.root,'data/updates/fallback-stages');fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(receipts,{recursive:true});fs.writeFileSync(path.join(stage,'setup.exe'),'busy');fs.writeFileSync(path.join(stage,'fallback.cancel'),'cancel');const receipt=path.join(receipts,name+'.json');fs.writeFileSync(receipt,JSON.stringify({stage,version:'9.0.0',root:f.root,created:0}));
 t.mock.method(fs.promises,'unlink',async()=>{throw Object.assign(Error('busy'),{code:'EBUSY'});});await cleanupFallbackStages(f.root,'9.0.0',{temp});assert.equal(fs.existsSync(path.join(stage,'fallback.cancel')),true);assert.equal(fs.existsSync(receipt),true);t.mock.restoreAll();await cleanupFallbackStages(f.root,'9.0.0',{temp});assert.equal(fs.existsSync(stage),false);
});
test('healthy startup cleans only completed transactions and preserves active/future recovery data',async t=>{
  const f=fixture(t),old=f.transaction('confirmed'),rolled=f.transaction('rolled-back'),active=f.transaction('applying'),future=f.transaction('confirmed','11.0.0'),applied=f.transaction('applied');
  const skip=confirmPortableStartup(f.root,'9.0.0');assert.ok(skip.includes(applied.id));
  // Simulate the live worker advancing after its confirmation marker was sent.
  fs.writeFileSync(path.join(applied.directory,'journal.json'),JSON.stringify({root:f.root,phase:'confirmed',version:'9.0.0'}));
  await cleanupTransactions(f.root,'9.0.0',skip);
  for(const item of [old,rolled])assert.equal(fs.existsSync(path.join(item.directory,'backup')),false);
  for(const item of [active,future,applied])assert.ok(fs.existsSync(path.join(item.directory,'backup')));
});
test('busy backup cleanup is retried on a later healthy startup',async t=>{
  const f=fixture(t),old=f.transaction('confirmed');
  t.mock.method(fs.promises,'rm',async()=>{throw Error('backup busy');});
  const report=await cleanupTransactions(f.root,'9.0.0');assert.deepEqual(report.deferred,[old.id]);assert.ok(fs.existsSync(path.join(old.directory,'backup')));
  t.mock.restoreAll();await cleanupTransactions(f.root,'9.0.0');assert.equal(fs.existsSync(path.join(old.directory,'backup')),false);
});

test('full setup backups survive until the installed version confirms startup',async t=>{
  const f=fixture(t),setup=f.transaction('awaiting-startup'),file=path.join(setup.directory,'journal.json');
  fs.writeFileSync(file,JSON.stringify({root:f.root,kind:'setup',phase:'awaiting-startup',version:'9.0.0'}));
  assert.deepEqual(confirmPortableStartup(f.root,'8.0.0'),[]);
  await cleanupTransactions(f.root,'9.0.0');assert.ok(fs.existsSync(path.join(setup.directory,'backup/old.dll')));
  await cleanupTransactions(f.root,'9.0.0',confirmPortableStartup(f.root,'9.0.0'));
  assert.equal(fs.existsSync(path.join(setup.directory,'backup')),false);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).phase,'confirmed');
});

test('startup cannot retire a full setup backup while its installer can still fail',async t=>{
  const f=fixture(t),setup=f.transaction('applied'),file=path.join(setup.directory,'journal.json');
  fs.writeFileSync(file,JSON.stringify({root:f.root,kind:'setup',phase:'applied',version:'9.0.0'}));
  const skip=confirmPortableStartup(f.root,'9.0.0');
  assert.ok(skip.includes(setup.id));assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).phase,'applied');
  await cleanupTransactions(f.root,'9.0.0',skip);assert.ok(fs.existsSync(path.join(setup.directory,'backup/old.dll')));
});
test('backup links and journals for a different installation never cause deletion',async t=>{
  const f=fixture(t),linked=f.transaction('confirmed'),foreign=f.transaction('confirmed');
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'keep');
  fs.symlinkSync(outside,path.join(linked.directory,'backup/link'),'junction');
  fs.writeFileSync(path.join(foreign.directory,'journal.json'),JSON.stringify({root:outside,phase:'confirmed',version:'9.0.0'}));
  await cleanupTransactions(f.root,'9.0.0');assert.ok(fs.existsSync(path.join(outside,'keep')));assert.ok(fs.existsSync(path.join(foreign.directory,'backup')));assert.ok(fs.existsSync(path.join(linked.directory,'backup')));
});
