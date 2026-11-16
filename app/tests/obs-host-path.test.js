const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareVoiceHost, cleanupVoiceHosts } = require('../main/obs-host-path');

test('isolated OBS host carries DLLs, reuses files and separates profiles and binary revisions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-host-'));
  try {
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'obs64.exe'), 'host');
    fs.writeFileSync(path.join(bin, 'obs.dll'), 'library');
    for (const vendor of ['nvenc', 'amf', 'qsv']) fs.writeFileSync(path.join(bin, `obs-${vendor}-test.exe`), vendor);
    fs.writeFileSync(path.join(bin, 'unrelated.exe'), 'ignore');
    fs.writeFileSync(path.join(bin, 'unrelated.txt'), 'ignore');
    const first = prepareVoiceHost(bin, path.join(root, 'profile1'));
    assert.notEqual(path.basename(first), 'obs64.exe');
    assert.equal(fs.readFileSync(first, 'utf8'), 'host');
    assert.equal(fs.readFileSync(path.join(path.dirname(first), 'obs.dll'), 'utf8'), 'library');
    assert.equal(fs.existsSync(path.join(path.dirname(first), 'unrelated.txt')), false);
    assert.equal(fs.existsSync(path.join(path.dirname(first), 'unrelated.exe')), false);
    for (const vendor of ['nvenc', 'amf', 'qsv']) assert.equal(fs.readFileSync(path.join(path.dirname(first), `obs-${vendor}-test.exe`), 'utf8'), vendor);
    assert.equal(prepareVoiceHost(bin, path.join(root, 'profile1')), first);
    assert.notEqual(path.basename(prepareVoiceHost(bin, path.join(root, 'profile2'))), path.basename(first));
    fs.writeFileSync(path.join(bin, 'obs-nvenc-test.exe'), 'updated probe');
    const updated = prepareVoiceHost(bin, path.join(root, 'profile1'));
    assert.notEqual(updated, first, 'probe updates invalidate cached isolated hosts');
    assert.equal(fs.readFileSync(path.join(path.dirname(updated), 'obs-nvenc-test.exe'), 'utf8'), 'updated probe');
    fs.writeFileSync(path.join(bin, 'new.dll'), 'new library');
    assert.notEqual(prepareVoiceHost(bin, path.join(root, 'profile1')), first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function cleanupFixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'obs-host-cleanup-')),bin=path.join(root,'bin'),profile=path.join(root,'profile');
  fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'obs64.exe'),'host');fs.writeFileSync(path.join(bin,'obs.dll'),'installed-library');
  const current=prepareVoiceHost(bin,profile),base=path.join(profile,'native-host');
  function old(name='0123456789ab'){
    const directory=path.join(base,name);fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'voice-obs-0123456789ab.exe'),'old-host');fs.writeFileSync(path.join(directory,'old.dll'),'old-library');return directory;
  }
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,bin,profile,current,base,old};
}

test('cleanup removes only obsolete owned hosts, preserves current host and measures hard links correctly',async t=>{
  const f=cleanupFixture(t),old=f.old(),linked=path.join(old,'linked.dll');fs.linkSync(path.join(f.bin,'obs.dll'),linked);
  const report=await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths:async()=>[]});
  assert.deepEqual(report.removed,['0123456789ab']);assert.equal(fs.existsSync(old),false);assert.ok(fs.existsSync(f.current));
  assert.equal(report.freedBytes,Buffer.byteLength('old-hostold-library'));assert.equal(report.removedBytes,report.freedBytes+Buffer.byteLength('installed-library'));
  assert.equal(fs.readFileSync(path.join(f.bin,'obs.dll'),'utf8'),'installed-library');
});

test('running obsolete hosts are retained, then removed on a later idle cleanup',async t=>{
  const f=cleanupFixture(t),old=f.old();
  const report=await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths:async()=>[path.join(old,'voice-obs-0123456789ab.exe').toUpperCase()]});
  assert.equal(report.removed.length,0);assert.ok(fs.existsSync(path.join(old,'old.dll')));
  await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths:async()=>[]});assert.equal(fs.existsSync(old),false);
});

test('failed or incomplete process inspection never deletes host files',async t=>{
  const f=cleanupFixture(t),old=f.old();
  for(const getActivePaths of [async()=>{throw Error('CIM denied');},async()=>[null],async()=>['relative/path.exe']]){
    const report=await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths});assert.equal(report.deferred,true);assert.ok(fs.existsSync(path.join(old,'old.dll')));
  }
});

test('unknown files, nested directories and linked entries remain untouched',async t=>{
  const f=cleanupFixture(t),unknown=f.old(),nested=f.old('abcdef012345'),linked=f.old('111111111111');
  fs.writeFileSync(path.join(unknown,'personal.txt'),'keep');fs.mkdirSync(path.join(nested,'folder'));
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.dll'),'keep');
  fs.symlinkSync(outside,path.join(linked,'linked-directory'),'junction');fs.symlinkSync(outside,path.join(f.base,'222222222222'),'junction');
  await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths:async()=>[]});
  for(const name of [unknown,nested,linked,outside])assert.ok(fs.existsSync(name));
  assert.equal(fs.readFileSync(path.join(outside,'keep.dll'),'utf8'),'keep');
});

test('a linked native-host root is refused without inspecting or deleting its target',async t=>{
  const f=cleanupFixture(t),otherProfile=path.join(f.root,'other-profile');fs.mkdirSync(otherProfile);
  fs.symlinkSync(f.base,path.join(otherProfile,'native-host'),'junction');
  const report=await cleanupVoiceHosts(f.bin,otherProfile,{getActivePaths:async()=>assert.fail('linked root must not be scanned')});
  assert.equal(report.deferred,true);assert.ok(fs.existsSync(f.current));
});

test('locked files defer deletion and can be retried without interrupting preparation',async t=>{
  const f=cleanupFixture(t),old=f.old(),locked=path.join(old,'old.dll'),unlink=fs.unlinkSync;
  t.mock.method(fs,'unlinkSync',target=>{if(target===locked)throw Object.assign(Error('busy'),{code:'EBUSY'});return unlink(target);});
  const report=await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths:async()=>[]});assert.ok(report.skipped.includes('0123456789ab'));assert.ok(fs.existsSync(locked));assert.equal(prepareVoiceHost(f.bin,f.profile),f.current);
  t.mock.restoreAll();await cleanupVoiceHosts(f.bin,f.profile,{getActivePaths:async()=>[]});assert.equal(fs.existsSync(old),false);
});

test('cleanup shares concurrent queries and protects a host prepared while inspection is pending',async t=>{
  const f=cleanupFixture(t);let release,calls=0;
  const options={getActivePaths:()=>{calls++;return new Promise(resolve=>{release=resolve;});}};
  const first=cleanupVoiceHosts(f.bin,f.profile,options),second=cleanupVoiceHosts(f.bin,f.profile,options);assert.equal(first,second);assert.equal(calls,1);
  fs.writeFileSync(path.join(f.bin,'new.dll'),'new version');const prepared=prepareVoiceHost(f.bin,f.profile);release([]);
  await first;assert.ok(fs.existsSync(prepared));assert.ok(fs.existsSync(f.current));
});
