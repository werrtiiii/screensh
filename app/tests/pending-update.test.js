const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');
const {createPendingUpdate}=require('../main/pending-update.cjs');

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-pending-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cache=path.join(dir,'cache'),file=path.join(dir,'pending.json'),fileName='ScreenSh-9.0.0-Setup.exe';
  const helper=new DownloadedUpdateHelper(cache),installer=path.join(helper.cacheDirForPendingUpdate,fileName);
  fs.mkdirSync(path.dirname(installer),{recursive:true});fs.writeFileSync(installer,'not an executable: update checksum fixture');
  const sha512=createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
  const info={version:'9.0.0'},fileInfo={info:{url:fileName,sha512,isAdminRightsRequired:true}};
  await helper.setDownloadedFile(installer,null,info,fileInfo,fileName,true);
  const pending=createPendingUpdate({file});pending.remember({downloadedUpdateHelper:helper},info);
  const nextHelper=new DownloadedUpdateHelper(cache);let signatures=0;
  const updater={getOrCreateDownloadHelper:async()=>nextHelper,logger:{info(){},warn(){}},verifySignature:async()=>{signatures++;return null;}};
  return {pending,file,installer,cache,nextHelper,updater,signatures:()=>signatures};
}
test('completed update metadata restores the real updater cache offline after restart',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.pending.restore(f.updater,'1.5.2'),{version:'9.0.0'});
  assert.equal(f.nextHelper.file,f.installer);assert.equal(f.nextHelper.versionInfo.version,'9.0.0');
  assert.equal(f.nextHelper.downloadedFileInfo.isAdminRightsRequired,true);assert.equal(f.signatures(),1);
});
test('already installed and older packages are skipped and their startup markers removed',async t=>{
  for(const current of ['9.0.0','10.0.0']) {
    const f=await fixture(t);assert.equal(await f.pending.restore(f.updater,current),null);assert.equal(fs.existsSync(f.file),false);assert.equal(f.signatures(),0);
  }
});
test('modified, missing and incomplete packages never become installable',async t=>{
  for(const mode of ['modified','missing','incomplete']) {
    const f=await fixture(t);
    if(mode==='modified')fs.appendFileSync(f.installer,'tampered');
    else if(mode==='missing')fs.unlinkSync(f.installer);
    else fs.unlinkSync(path.join(f.cache,'pending','update-info.json'));
    if(mode==='incomplete')assert.equal(await f.pending.restore(f.updater,'1.5.2'),null);
    else await assert.rejects(f.pending.restore(f.updater,'1.5.2'),/缺失或校验失败/);
    assert.equal(f.nextHelper.file,null);assert.equal(fs.existsSync(f.file),false);
  }
});
test('startup rejects out-of-cache names and failed publisher signature verification',async t=>{
  const badPath=await fixture(t),record=JSON.parse(fs.readFileSync(badPath.file,'utf8'));record.fileName='../outside.exe';fs.writeFileSync(badPath.file,JSON.stringify(record));
  await assert.rejects(badPath.pending.restore(badPath.updater,'1.5.2'),/更新信息无效/);assert.equal(badPath.signatures(),0);
  const badSignature=await fixture(t);badSignature.updater.verifySignature=async()=> 'publisher mismatch';
  await assert.rejects(badSignature.pending.restore(badSignature.updater,'1.5.2'),/签名校验失败/);assert.equal(badSignature.nextHelper.file,null);
});
