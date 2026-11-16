const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {cleanupTransactions}=require('../main/update-cleanup.cjs');
const {confirmPortableStartup}=require('../main/portable-confirm.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'update-backup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let i=0;return {root,transaction(phase,version='9.0.0'){
  const id='12345678-1234-1234-1234-'+String(++i).padStart(12,'0'),directory=path.join(root,'data/updates/transactions',id);
  fs.mkdirSync(path.join(directory,'backup'),{recursive:true});fs.writeFileSync(path.join(directory,'backup/old.dll'),'old');fs.writeFileSync(path.join(directory,'journal.json'),JSON.stringify({root,phase,version}));return {id,directory};
}};}
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
test('backup links and journals for a different installation never cause deletion',async t=>{
  const f=fixture(t),linked=f.transaction('confirmed'),foreign=f.transaction('confirmed');
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'keep');
  fs.symlinkSync(outside,path.join(linked.directory,'backup/link'),'junction');
  fs.writeFileSync(path.join(foreign.directory,'journal.json'),JSON.stringify({root:outside,phase:'confirmed',version:'9.0.0'}));
  await cleanupTransactions(f.root,'9.0.0');assert.ok(fs.existsSync(path.join(outside,'keep')));assert.ok(fs.existsSync(path.join(foreign.directory,'backup')));assert.ok(fs.existsSync(path.join(linked.directory,'backup')));
});
