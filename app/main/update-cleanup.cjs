let fs;try{fs=require('original-fs');}catch{fs=require('node:fs');}
const path=require('node:path');
const {compareVersions}=require('./updater');
const {noLinks,parseManifest,digest,MAX_MANIFEST}=require('./update-blocks.cjs');
function packageVersion(name){return name?.match(/^(?:temp-)?ScreenSh-(\d+\.\d+\.\d+)-(?:Setup\.exe(?:\.blockmap)?|Update\.(?:zip|json))$/)?.[1]||null;}
async function unlinkOwned(file){
  noLinks(path.dirname(file));
  const stat=await fs.promises.lstat(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(!stat?.isFile()||stat.isSymbolicLink())return false;
  await fs.promises.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});return true;
}
function assertTree(directory){
  noLinks(directory);const stat=fs.lstatSync(directory,{throwIfNoEntry:false});if(!stat)return;
  if(!stat.isDirectory())throw Error('Invalid update cleanup directory');
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error('Linked update cleanup entry');
    if(entry.isDirectory())assertTree(path.join(directory,entry.name));
    else if(!entry.isFile())throw Error('Unsupported update cleanup entry');
  }
}
async function removeTree(directory){assertTree(directory);await fs.promises.rm(directory,{recursive:true,force:true});}
async function cleanupIncrementalCache(cache,currentVersion){
  const directory=path.join(cache,'incremental');noLinks(directory);
  if(!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const match=entry.name.match(/^(\d+\.\d+\.\d+)-([a-f0-9]{64})$/);
    if(!entry.isDirectory()||entry.isSymbolicLink()||!match||compareVersions(match[1],currentVersion)>0)continue;
    const stage=path.join(directory,entry.name),manifest=path.join(stage,'manifest.json');noLinks(manifest);
    const stat=fs.statSync(manifest,{throwIfNoEntry:false});
    if(!stat?.isFile()||stat.size>MAX_MANIFEST)continue;
    try{const raw=fs.readFileSync(manifest);parseManifest(raw,match[1]);if(digest(raw)!==match[2])continue;}catch{continue;}
    await removeTree(stage);
  }
}
async function cleanupTransactions(root,currentVersion,skip=[]){
  const directory=path.join(root,'data/updates/transactions'),report={removed:[],deferred:[]};
  noLinks(directory);if(!fs.existsSync(directory))return report;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9-]{36}$/.test(entry.name)||skip.includes(entry.name))continue;
    try{
      const transaction=path.join(directory,entry.name),file=path.join(transaction,'journal.json');noLinks(file);
      const journal=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      if(!['confirmed','rolled-back'].includes(journal.phase)||!/^\d+\.\d+\.\d+$/.test(journal.version)||compareVersions(journal.version,currentVersion)>0||path.resolve(journal.root).toLowerCase()!==path.resolve(root).toLowerCase())continue;
      // Never retry or discard an applying/applied transaction: it may still
      // belong to the live update worker or be needed for manual recovery.
      for(const name of ['backup','new'])await removeTree(path.join(transaction,name));
      report.removed.push(entry.name);
    }catch{report.deferred.push(entry.name);}
  }
  return report;
}
module.exports={packageVersion,unlinkOwned,removeTree,cleanupIncrementalCache,cleanupTransactions};
