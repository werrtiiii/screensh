const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {packageBlocks}=require('../scripts/package-blocks.cjs');
const {digest,prepareIncremental,prepareInWorker,parseManifest,verifyPrepared,stageDirectory}=require('../main/update-blocks.cjs');
const {fetchUpdateRange,incrementalArtifact,PortableUpdater}=require('../main/portable-updater.cjs');
const {CancellationToken,CancellationError}=require('builder-util-runtime');
async function fixture(t,change){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-blocks-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'install'),source=path.join(dir,'source'),dist=path.join(dir,'dist'),pending=path.join(root,'data/updates/pending');
  const original=crypto.randomBytes(8*1024*1024),files=[];
  for(const base of [root,source,dist,pending])fs.mkdirSync(base,{recursive:true});
  for(const [name,old] of [['ScreenSh.exe',Buffer.from('exe')],['resources/app.asar',original],['resources/empty',Buffer.alloc(0)]]){
    const next=change?change(name,old):old;
    for(const [base,bytes] of [[root,old],[source,next]]){const target=path.join(base,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
    files.push({path:name,size:next.length,sha256:digest(next)});
  }
  const artifact=await packageBlocks({source,dist,version:'9.0.0',files}),raw=fs.readFileSync(path.join(dist,artifact.url)),manifest=parseManifest(raw,'9.0.0'),pack=fs.readFileSync(path.join(dist,manifest.pack.url));
  const requests=[];
  return {root,pending,raw,version:'9.0.0',manifest,artifact,pack,requests,fetchRange:async(_pack,start,length)=>{requests.push({start,length});return pack.subarray(start,start+length);}};
}
test('identical installation requires zero payload bytes, without an old archive',async t=>{
  const f=await fixture(t),result=await prepareIncremental(f);assert.equal(result.transferred,0);assert.equal(f.requests.length,0);assert.ok(await verifyPrepared(f));
});
test('content-defined blocks reuse most of a large file after an insertion',async t=>{
  const f=await fixture(t,(name,old)=>name.endsWith('.asar')?Buffer.concat([old.subarray(0,2100000),Buffer.from('inserted bytes'),old.subarray(2100000)]):old);
  const progress=[],result=await prepareIncremental({...f,onProgress:value=>progress.push(value)});
  assert.ok(result.transferred<3*1024*1024,JSON.stringify(result));assert.ok(result.reused>5*1024*1024);assert.ok(await verifyPrepared(f));
  assert.equal(progress.at(-1).percent,100);assert.equal(progress.at(-1).downloadMode,'differential');
  assert.equal(digest(fs.readFileSync(path.join(result.stage,'resources/app.asar.payload'))),f.manifest.files.find(file=>file.path.endsWith('.asar')).sha256);
});
test('a missing or corrupted local base downloads and verifies the affected file',async t=>{
  const f=await fixture(t);fs.writeFileSync(path.join(f.root,'resources/app.asar'),'corrupted local base');
  await prepareInWorker({...f,checkCancelled(){},onProgress(){}});assert.ok(await verifyPrepared(f));assert.ok(f.requests.length);
  fs.writeFileSync(path.join(stageDirectory(f.pending,f.raw),'resources/app.asar.payload'),'damaged staged file');assert.equal(await verifyPrepared(f),false);
  await prepareIncremental(f);assert.ok(await verifyPrepared(f));
});
test('verified blocks survive a real pending-cache reset and resume inside a large file',async t=>{
  const f=await fixture(t);fs.writeFileSync(path.join(f.root,'resources/app.asar'),'old damaged base');
  let calls=0,firstBytes=0;
  await assert.rejects(prepareIncremental({...f,fetchRange:async(pack,start,length)=>{
    if(++calls===2)throw Error('network interrupted');firstBytes+=length;return f.fetchRange(pack,start,length);
  }}),/network interrupted/);
  const stage=stageDirectory(f.pending,f.raw);assert.ok(firstBytes>0);assert.ok(fs.readdirSync(path.join(stage,'blocks')).length);
  const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');await new DownloadedUpdateHelper(path.dirname(f.pending)).clear();
  assert.ok(fs.existsSync(stage),'transient pending cleanup must not remove verified checkpoints');
  const result=await prepareIncremental(f);assert.ok(result.transferred<f.pack.length);assert.equal(result.transferred+firstBytes,f.manifest.files.find(file=>file.path.endsWith('.asar')).chunks.reduce((sum,c)=>sum+c.length,0));
  assert.ok(await verifyPrepared(f));assert.equal(fs.existsSync(path.join(stage,'blocks')),false);
});
test('a completed changed file survives interruption and is not fetched again',async t=>{
  const f=await fixture(t,(name,old)=>name==='ScreenSh.exe'?Buffer.from('new executable'):name.endsWith('.asar')?Buffer.concat([old,Buffer.from('new resource')]):old);
  let calls=0;await assert.rejects(prepareIncremental({...f,fetchRange:async(pack,start,length)=>{if(++calls===2)throw Error('offline');return f.fetchRange(pack,start,length);}}),/offline/);
  const stage=stageDirectory(f.pending,f.raw);assert.ok(fs.existsSync(path.join(stage,'ScreenSh.exe.payload')));
  const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');await new DownloadedUpdateHelper(path.dirname(f.pending)).clear();
  const firstChunk=f.manifest.files[0].chunks[0];
  await prepareIncremental({...f,fetchRange:async(pack,start,length)=>{assert.notEqual(start,firstChunk.offset,'completed executable must be reused');return f.fetchRange(pack,start,length);}});
  assert.ok(await verifyPrepared(f));
});
test('corrupted and truncated ranges never produce an installable staging tree',async t=>{
  const f=await fixture(t,(_name,old)=>Buffer.concat([old,Buffer.from('changed')]));
  await assert.rejects(prepareIncremental({...f,fetchRange:async()=>Buffer.alloc(1)}),/Truncated/);assert.equal(await verifyPrepared(f),false);
  await assert.rejects(prepareIncremental({...f,fetchRange:async(_p,_o,length)=>Buffer.alloc(length)}));assert.equal(await verifyPrepared(f),false);
});
test('manifest traversal, case collisions and untrusted pack URLs are rejected',async t=>{
  const f=await fixture(t);for(const name of ['../escape','data/profile.json','resources/CON.txt','/absolute']){const manifest=structuredClone(f.manifest);manifest.files[0].path=name;assert.throws(()=>parseManifest(Buffer.from(JSON.stringify(manifest)),'9.0.0'));}
  const manifest=structuredClone(f.manifest);manifest.pack.url='https://other.example/payload';assert.throws(()=>parseManifest(Buffer.from(JSON.stringify(manifest)),'9.0.0'));
  assert.throws(()=>incrementalArtifact({version:'9.0.0',incremental:{...f.artifact,url:'../manifest.json'}}));
});
test('range requests require 206 with the exact byte interval, reject truncation and honor cancellation',async()=>{
  const url=new URL('https://github.com/owner/repo/releases/download/9.0.0/blocks.bin');
  assert.deepEqual(await fetchUpdateRange(url,3,4,12,null,async(_url,options)=>{assert.equal(options.headers.Range,'bytes=3-6');return new Response(Buffer.from('abcd'),{status:206,headers:{'Content-Range':'bytes 3-6/12'}});}),Buffer.from('abcd'));
  await assert.rejects(fetchUpdateRange(url,3,4,12,null,async()=>new Response('full file')),/byte ranges/);
  await assert.rejects(fetchUpdateRange(url,3,4,12,null,async()=>new Response('a',{status:206,headers:{'Content-Range':'bytes 3-6/12'}})),/Truncated/);
  const token=new CancellationToken();token.cancel();await assert.rejects(fetchUpdateRange(url,3,4,12,token,()=>assert.fail('cancelled request')),CancellationError);
});
test('incremental failure falls back to the full ZIP, but cancellation does not',async t=>{
  const f=await fixture(t),zip={url:'ScreenSh-9.0.0-Update.zip',size:12,sha512:'A'.repeat(86)+'=='},types=[];
  const options={updateInfoAndProvider:{info:{version:'9.0.0',portable:zip,incremental:f.artifact},provider:{resolveFiles:info=>info.files.map(info=>({info,url:new URL('https://github.com/o/r/releases/download/9.0.0/'+info.url)}))}},cancellationToken:new CancellationToken()};
  const fake={getOrCreateDownloadHelper:async()=>({cacheDirForPendingUpdate:f.pending}),_logger:{warn(){}},executeDownload:async task=>{types.push(task.fileExtension);if(task.fileExtension==='json')throw Error('source has no ranges');return 'full ZIP';}};
  assert.equal(await PortableUpdater.prototype.doDownloadUpdate.call(fake,options),'full ZIP');assert.deepEqual(types,['json','zip']);
  types.length=0;fake.executeDownload=async task=>{types.push(task.fileExtension);throw new CancellationError();};
  await assert.rejects(PortableUpdater.prototype.doDownloadUpdate.call(fake,options),CancellationError);assert.deepEqual(types,['json']);
});
test('successful startup deletes incremental staging and previous ZIP/setup bases, failed attempts retain them',async t=>{
  const f=await fixture(t,(name,old)=>name.endsWith('.asar')?Buffer.concat([old,Buffer.from('new')]):old),prepared=await prepareIncremental(f);
  const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper'),{createPendingUpdate}=require('../main/pending-update.cjs');
  const helper=new DownloadedUpdateHelper(path.dirname(f.pending)),filename=path.join(f.pending,f.artifact.url);fs.writeFileSync(filename,f.raw);
  await helper.setDownloadedFile(filename,null,{version:'9.0.0'},{info:f.artifact},f.artifact.url,true);
  const pending=createPendingUpdate({file:path.join(f.root,'data/user-data/update.pending')}),updater={downloadedUpdateHelper:helper,getOrCreateDownloadHelper:async()=>helper};
  pending.remember(updater,{version:'9.0.0'});pending.markInstallAttempt(updater,'8.0.0');
  for(const name of ['installer.exe','portable.zip','current.blockmap'])fs.writeFileSync(path.join(helper.cacheDir,name),'old base');
  assert.equal(await pending.confirmInstalled(updater,'8.0.0'),null);assert.ok(fs.existsSync(prepared.stage));
  const remove=fs.promises.rm;
  t.mock.method(fs.promises,'rm',async(target,...args)=>{if(target===prepared.stage)throw Error('temporary directory is busy');return remove.call(fs.promises,target,...args);});
  await assert.rejects(pending.confirmInstalled(updater,'9.0.0'),/busy/);assert.ok(fs.existsSync(filename));assert.ok(fs.existsSync(path.join(f.pending,'update-info.json')));
  t.mock.restoreAll();
  assert.equal((await pending.confirmInstalled(updater,'9.0.0')).version,'9.0.0');assert.equal(fs.existsSync(prepared.stage),false);assert.equal(fs.existsSync(filename),false);
  for(const name of ['installer.exe','portable.zip','current.blockmap'])assert.equal(fs.existsSync(path.join(helper.cacheDir,name)),false);
});
