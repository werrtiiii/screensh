const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

// 1.5.6 can install only the full NSIS EXE. New formats must remain additive.
async function checkLegacyRelease(dist,info,version){
  if(!/^\d+\.\d+\.\d+$/.test(version)||info?.version!==version)throw Error('Legacy release version mismatch');
  const name=`ScreenSh-${version}-Setup.exe`;
  if(info.packages||!Array.isArray(info.files)||info.files.length!==1||info.files[0]?.url!==name||info.path!==name)
    throw Error('Legacy clients require the full Setup.exe in files and path');
  const file=info.files[0];
  if(!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512||'')||info.sha512!==file.sha512)
    throw Error('Legacy release checksum metadata mismatch');
  const target=path.join(dist,name),stat=fs.statSync(target);
  if(!stat.isFile()||!Number.isSafeInteger(file.size)||file.size<=0||stat.size!==file.size)
    throw Error('Legacy installer size mismatch');
  const hash=crypto.createHash('sha512');
  for await(const chunk of fs.createReadStream(target))hash.update(chunk);
  if(hash.digest('base64')!==file.sha512)throw Error('Legacy installer checksum mismatch');
}
if(require.main===module){
  const dist=path.resolve(__dirname,'../dist'),info=require('js-yaml').load(fs.readFileSync(path.join(dist,'latest.yml'),'utf8'));
  checkLegacyRelease(dist,info,require('../package.json').version)
    .then(()=>console.log('LEGACY_1_5_6_RELEASE_METADATA_OK'))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={checkLegacyRelease};
