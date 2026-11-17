const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {checkLegacyRelease}=require('../scripts/check-legacy-release.cjs');
function fixture(t){
  const dist=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-legacy-release-'));
  t.after(()=>fs.rmSync(dist,{recursive:true,force:true}));
  const bytes=Buffer.from('fixture installer'),url='ScreenSh-1.5.7-Setup.exe';
  const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(path.join(dist,url),bytes);
  return {dist,info:{version:'1.5.7',files:[{url,sha512,size:bytes.length}],path:url,sha512}};
}
test('legacy release keeps the full EXE available alongside new update formats',async t=>{
  const {dist,info}=fixture(t);info.portable={url:'ScreenSh-1.5.7-Update.zip'};info.incremental={url:'ScreenSh-1.5.7-Update.json'};
  await checkLegacyRelease(dist,info,'1.5.7');
});
test('legacy release rejects incompatible names, versions, and metadata',async t=>{
  const {dist,info}=fixture(t);
  for(const value of [
    {...info,version:'1.5.6'},
    {...info,files:[{...info.files[0],url:'ScreenSh-1.5.7-Update.zip'}]},
    {...info,path:'other.exe'},
    {...info,sha512:'invalid'},
    {...info,files:[{...info.files[0],size:1}]},
    {...info,packages:{x64:{file:'web.exe'}}},
  ])await assert.rejects(checkLegacyRelease(dist,value,'1.5.7'));
});
test('legacy release rejects a replaced installer even when its size is unchanged',async t=>{
  const {dist,info}=fixture(t);fs.writeFileSync(path.join(dist,info.path),Buffer.alloc(info.files[0].size));
  await assert.rejects(checkLegacyRelease(dist,info,'1.5.7'),/checksum/);
});
