// Prepare a real release's incremental download in an isolated installation.
const fs=require('node:fs'),path=require('node:path');
const {prepareInWorker,parseManifest}=require('../../main/update-blocks.cjs');
const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');
const {createPendingUpdate}=require('../../main/pending-update.cjs');
const [root,dist]=process.argv.slice(2),version=require('../../package.json').version;
(async()=>{
  const info=require('js-yaml').load(fs.readFileSync(path.join(dist,'latest.yml'),'utf8')),pending=path.join(root,'data/updates/pending');
  const raw=fs.readFileSync(path.join(dist,info.incremental.url)),manifest=parseManifest(raw,version),packed=fs.openSync(path.join(dist,manifest.pack.url),'r');
  let prepared;
  try{prepared=await prepareInWorker({root,pending,raw,version,checkCancelled(){},onProgress(){},fetchRange:async(_pack,offset,length)=>{
    const bytes=Buffer.alloc(length),count=fs.readSync(packed,bytes,0,length,offset);if(count!==length)throw Error('Fixture pack truncated');return bytes;
  }});}finally{fs.closeSync(packed);}
  const helper=new DownloadedUpdateHelper(path.dirname(pending)),filename=path.join(pending,info.incremental.url);fs.writeFileSync(filename,raw);
  await helper.setDownloadedFile(filename,null,{version},{info:info.incremental},info.incremental.url,true);
  createPendingUpdate({file:path.join(root,'data/user-data/auto-update.json.pending')}).remember({downloadedUpdateHelper:helper},{version});
  for(const name of ['installer.exe','portable.zip'])fs.writeFileSync(path.join(helper.cacheDir,name),'old cache');
  fs.writeFileSync(path.join(root,'data/expected-stage.txt'),prepared.stage);
})().catch(error=>{console.error(error);process.exitCode=1;});
