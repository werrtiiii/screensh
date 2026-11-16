// Electron exposes app.asar as a virtual directory through its regular fs.
// Updates compare the real archive bytes, including inside worker threads.
let fs;try{fs=require('original-fs');}catch{fs=require('node:fs');}
const path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const digest=(data,algorithm='sha256',encoding='hex')=>crypto.createHash(algorithm).update(data).digest(encoding);
const MAX_FILE=512*1024*1024, MAX_MANIFEST=8*1024*1024;
// Content-defined boundaries survive insertions: unchanged DLLs and most of an
// ASAR can be reused without retaining a previous archive or block map.
const gear=new Uint32Array(256);let seed=0x9e3779b9;
for(let i=0;i<256;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;gear[i]=seed>>>0;}
function chunks(bytes,checkCancelled=()=>{}){
  const result=[];let start=0,rolling=0;
  for(let i=0;i<bytes.length;i++){
    if((i&1048575)===0)checkCancelled();
    rolling=((rolling<<1)+gear[bytes[i]])>>>0;
    const length=i+1-start;
    if(length>=65536&&((rolling&262143)===0||length>=1048576)){
      result.push({start,size:length,sha256:digest(bytes.subarray(start,i+1))});start=i+1;rolling=0;
    }
  }
  if(start<bytes.length)result.push({start,size:bytes.length-start,sha256:digest(bytes.subarray(start))});
  return result;
}
function safePath(value){
  if(typeof value!=='string'||!value||value.length>220||/[\\:\x00-\x1f]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/[<>"|?*]/.test(part)||/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part))||/^(data|uninstall[^/]*|update-manifest\.json)(\/|$)/i.test(value))throw Error('Unsafe update path');
  return value;
}
function noLinks(file){
  let current=path.resolve(file);
  for(;;){const stat=fs.lstatSync(current,{throwIfNoEntry:false});if(stat?.isSymbolicLink())throw Error('Linked update path');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
function readFile(file){noLinks(file);const stat=fs.statSync(file,{throwIfNoEntry:false});if(!stat)return null;if(!stat.isFile()||stat.size>MAX_FILE)throw Error('Invalid update file');return fs.readFileSync(file);}
function validateManifest(value,version){
  if(value?.schemaVersion!==2||value.version!==version||!/^\d+\.\d+\.\d+$/.test(version)||value.pack?.url!==`ScreenSh-${version}-Blocks.bin`||!/^[A-Za-z0-9+/]{86}==$/.test(value.pack.sha512||'')||!Number.isSafeInteger(value.pack.size)||value.pack.size<0||value.pack.size>8589934592||!Array.isArray(value.files)||!value.files.length||value.files.length>30000)throw Error('Invalid incremental manifest');
  const seen=new Set();let total=0,end=0;
  for(const file of value.files){
    safePath(file.path);const key=file.path.toLowerCase();
    if(seen.has(key)||!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE||!/^[a-f0-9]{64}$/.test(file.sha256)||!Array.isArray(file.chunks)||file.chunks.length>10000)throw Error('Invalid incremental file');
    seen.add(key);total+=file.size;let size=0;
    for(const chunk of file.chunks){
      if(!Number.isSafeInteger(chunk.size)||chunk.size<=0||chunk.size>1048576||!/^[a-f0-9]{64}$/.test(chunk.sha256)||!Number.isSafeInteger(chunk.offset)||chunk.offset!==end||!Number.isSafeInteger(chunk.length)||chunk.length<=0||chunk.length>1049600)throw Error('Invalid incremental block');
      size+=chunk.size;end+=chunk.length;
    }
    if(size!==file.size)throw Error('Incremental file size mismatch');
  }
  const names=[...seen];
  if(total>8589934592||end!==value.pack.size||!seen.has('screensh.exe')||!seen.has('resources/app.asar')||names.some(name=>name.split('/').slice(0,-1).some((_,i)=>seen.has(name.split('/').slice(0,i+1).join('/')))))throw Error('Incomplete or conflicting incremental payload');
  return value;
}
function stageDirectory(pending,raw){
  const version=JSON.parse(raw.toString('utf8')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid staging version');
  // electron-updater clears pending on a failed/cancelled request. Keep verified
  // checkpoints outside that transient directory so retries can reuse them.
  return path.join(path.dirname(pending),'incremental',version+'-'+digest(raw));
}
function decodedBlock(packed,chunk){
  const bytes=zlib.gunzipSync(packed,{maxOutputLength:chunk.size});
  if(bytes.length!==chunk.size||digest(bytes)!==chunk.sha256)throw Error('Update block checksum mismatch');
  return bytes;
}
function checkpoint(file,bytes){
  noLinks(file);noLinks(file+'.new');fs.mkdirSync(path.dirname(file),{recursive:true});fs.rmSync(file+'.new',{force:true});
  fs.writeFileSync(file+'.new',bytes,{flag:'wx'});fs.renameSync(file+'.new',file);
}
function parseManifest(raw,version){if(raw.length>MAX_MANIFEST)throw Error('Incremental manifest too large');return validateManifest(JSON.parse(raw.toString('utf8')),version);}
async function verifyPrepared({root,pending,raw,version}){
  try{const manifest=parseManifest(raw,version),stage=stageDirectory(pending,raw);for(const file of manifest.files){const staged=readFile(path.join(stage,file.path+'.payload')),local=staged||readFile(path.join(root,file.path));if(!local||local.length!==file.size||digest(local)!==file.sha256)return false;}return true;}catch{return false;}
}
async function prepareIncremental({root,pending,raw,version,fetchRange,onProgress=()=>{},checkCancelled=()=>{}}){
  const manifest=parseManifest(raw,version),stage=stageDirectory(pending,raw),plans=[];noLinks(stage);fs.mkdirSync(stage,{recursive:true});
  checkpoint(path.join(stage,'manifest.json'),raw);
  const blockCache=path.join(stage,'blocks');
  let total=0,transferred=0,reused=0;
  for(const file of manifest.files){
    checkCancelled();const target=path.join(stage,file.path+'.payload'),staged=readFile(target);
    if(staged&&staged.length===file.size&&digest(staged)===file.sha256)continue;
    const old=readFile(path.join(root,file.path));
    if(old&&old.length===file.size&&digest(old)===file.sha256){if(staged)fs.unlinkSync(target);reused+=file.size;continue;}
    const oldChunks=new Map(old?chunks(old,checkCancelled).map(chunk=>[chunk.sha256,chunk]):[]);
    const blocks=file.chunks.map(chunk=>{
      const local=oldChunks.get(chunk.sha256);
      if(local?.size===chunk.size){reused+=chunk.size;return {...chunk,local};}
      const cached=path.join(blockCache,chunk.sha256+'.gz');noLinks(cached);
      if(fs.existsSync(cached)){
        try{if(fs.statSync(cached).size!==chunk.length)throw Error('Invalid cached block size');decodedBlock(fs.readFileSync(cached),chunk);reused+=chunk.size;return {...chunk,cached};}
        catch{fs.unlinkSync(cached);}
      }
      total+=chunk.length;return chunk;
    });
    plans.push({file,target,blocks});
    // Yield between files so cancellation and the update window remain responsive.
    await new Promise(resolve=>setImmediate(resolve));
  }
  const report=()=>onProgress({total,transferred,percent:total?transferred/total*100:100,downloadMode:'differential',reused});report();
  for(const plan of plans){
    checkCancelled();const old=readFile(path.join(root,plan.file.path)),output=Buffer.alloc(plan.file.size);let position=0;
    for(let i=0;i<plan.blocks.length;){
      checkCancelled();
      const block=plan.blocks[i];
      if(block.local){if(!old)throw Error('Local update base disappeared');old.copy(output,position,block.local.start,block.local.start+block.size);position+=block.size;i++;continue;}
      if(block.cached){noLinks(block.cached);decodedBlock(fs.readFileSync(block.cached),block).copy(output,position);position+=block.size;i++;continue;}
      // Batch adjacent missing blocks, avoiding thousands of tiny HTTP requests.
      let j=i+1,length=block.length;
      while(j<plan.blocks.length&&!plan.blocks[j].local&&!plan.blocks[j].cached&&length+plan.blocks[j].length<=8*1024*1024){length+=plan.blocks[j].length;j++;}
      checkCancelled();const packed=await fetchRange(manifest.pack,block.offset,length);checkCancelled();
      if(!Buffer.isBuffer(packed)||packed.length!==length)throw Error('Truncated update range');
      let offset=0;
      for(;i<j;i++){
        const chunk=plan.blocks[i],compressed=packed.subarray(offset,offset+chunk.length),bytes=decodedBlock(compressed,chunk);
        checkpoint(path.join(blockCache,chunk.sha256+'.gz'),compressed);
        bytes.copy(output,position);position+=bytes.length;offset+=chunk.length;
      }
      transferred+=length;report();
    }
    if(digest(output)!==plan.file.sha256)throw Error('Reconstructed update checksum mismatch');
    checkpoint(plan.target,output);
    await new Promise(resolve=>setImmediate(resolve));
  }
  noLinks(blockCache);fs.rmSync(blockCache,{recursive:true,force:true});
  report();return {stage,total,transferred,reused};
}
// Hashing and reconstructing large files must not stall Electron's main thread.
async function prepareInWorker(options){
  const {Worker}=require('node:worker_threads');
  return new Promise((resolve,reject)=>{
    const cancellation=new SharedArrayBuffer(4),flag=new Int32Array(cancellation);
    const worker=new Worker(__filename,{workerData:{root:options.root,pending:options.pending,raw:options.raw,version:options.version,action:options.action,cancellation}});
    const timer=options.checkCancelled?setInterval(()=>{try{options.checkCancelled();}catch{Atomics.store(flag,0,1);}},20):null;timer?.unref();
    let finished=false;
    worker.on('message',async message=>{
      if(message.type==='range'){
        try{options.checkCancelled();const bytes=await options.fetchRange(message.pack,message.offset,message.length);options.checkCancelled();worker.postMessage({id:message.id,bytes});}
        catch(error){worker.postMessage({id:message.id,error:error.message});}
      }else if(message.type==='progress')options.onProgress?.(message.progress);
      else if(message.type==='done'){finished=true;clearInterval(timer);try{options.checkCancelled?.();resolve(message.result);}catch(error){reject(error);}}
      else if(message.type==='error'){finished=true;clearInterval(timer);reject(Error(message.error));}
    });
    worker.once('error',error=>{clearInterval(timer);reject(error);});worker.once('exit',code=>{clearInterval(timer);if(!finished)reject(Error('Incremental worker exited: '+code));});
  });
}
const {isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread&&workerData?.raw){
  let id=0;const requests=new Map();
  parentPort.on('message',message=>{const request=requests.get(message.id);if(request){requests.delete(message.id);message.error?request.reject(Error(message.error)):request.resolve(Buffer.from(message.bytes));}});
  const run=workerData.action==='verify'?verifyPrepared:prepareIncremental;
  run({...workerData,raw:Buffer.from(workerData.raw),checkCancelled:()=>{if(Atomics.load(new Int32Array(workerData.cancellation),0))throw Error('Incremental update cancelled');},fetchRange:(pack,offset,length)=>new Promise((resolve,reject)=>{requests.set(++id,{resolve,reject});parentPort.postMessage({type:'range',id,pack,offset,length});}),onProgress:progress=>parentPort.postMessage({type:'progress',progress})})
    .then(result=>parentPort.postMessage({type:'done',result}),error=>parentPort.postMessage({type:'error',error:error.message})).finally(()=>parentPort.close());
}
const verifyInWorker=options=>prepareInWorker({...options,action:'verify'});
module.exports={chunks,digest,safePath,noLinks,parseManifest,validateManifest,stageDirectory,prepareIncremental,prepareInWorker,verifyPrepared,verifyInWorker,MAX_MANIFEST};
