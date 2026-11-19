let fs;try{fs=require('original-fs');}catch{fs=require('node:fs');}
const path = require('node:path');
const {compareUpdateKeys,parseUpdateKey,updateKey} = require('./update-identity.cjs');
const {createHash}=require('node:crypto');
async function sha512(file){const hash=createHash('sha512');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('base64');}

// Keep only the version and verified download metadata. Installer paths are
// always resolved inside electron-updater's own pending cache.
function createPendingUpdate({file}) {
  const attemptFile=file+'.install-attempt';
  function readAttempt(){try{return JSON.parse(fs.readFileSync(attemptFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('无法读取更新安装记录，请手动覆盖安装');}}
  function clear() { try { fs.unlinkSync(file); } catch(error) { if(error.code!=='ENOENT')throw error; } }
  function valid(record) {
    const identity = parseUpdateKey(record?.version);
    return identity
      && typeof record.fileName==='string' && (identity.build===1&&/^[^\\/:]+\.exe$/i.test(record.fileName)||record.fileName===`ScreenSh-${record.version}-Update.zip`||record.fileName===`ScreenSh-${record.version}-Update.json`)
      && /^[A-Za-z0-9+/]{86}==$/.test(record.sha512);
  }
  return {
    wasInstallAttempted(updater){const attempt=readAttempt(),metadata=updater.downloadedUpdateHelper?.downloadedFileInfo;return !!(attempt&&metadata&&attempt.fileName===metadata.fileName&&attempt.sha512===metadata.sha512);},
    markInstallAttempt(updater,currentVersion){
      const metadata=updater.downloadedUpdateHelper?.downloadedFileInfo;
      if(!metadata?.fileName||!metadata.sha512)throw Error('缺少更新安装信息');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(attemptFile+'.tmp',JSON.stringify({fromVersion:currentVersion,fileName:metadata.fileName,sha512:metadata.sha512,startedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(attemptFile+'.tmp',attemptFile);
    },
    remember(updater, info) {
      const helper=updater.downloadedUpdateHelper, metadata=helper?.downloadedFileInfo;
      const record={...metadata,version:updateKey(info)};
      if (!valid(record) || helper.packageFile || path.resolve(helper.file)!==path.resolve(helper.cacheDirForPendingUpdate,record.fileName)) throw Error('无法保存已下载的更新信息');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file+'.tmp',JSON.stringify(record),{mode:0o600});fs.renameSync(file+'.tmp',file);
    },
    async restore(updater,currentVersion) {
      let record;
      try { record=JSON.parse(await fs.promises.readFile(file,'utf8')); }
      catch(error) { if(error.code==='ENOENT')return null; throw Error('无法读取已下载的更新信息'); }
      if (!valid(record)) { clear(); throw Error('本地更新信息无效，请重新下载更新'); }
      // Keep the receipt until the new renderer has actually initialized.
      if (compareUpdateKeys(record.version,currentVersion)<=0) return null;
      const helper=await updater.getOrCreateDownloadHelper();
      let cached;
      try { cached=JSON.parse(await fs.promises.readFile(path.join(helper.cacheDirForPendingUpdate,'update-info.json'),'utf8')); }
      catch { clear(); return null; }
      if (cached.fileName!==record.fileName || cached.sha512!==record.sha512) { clear(); throw Error('本地更新包信息不匹配，请重新下载更新'); }
      const fileInfo={info:{url:record.fileName,sha512:record.sha512,isAdminRightsRequired:record.isAdminRightsRequired===true}};
      const installer=await helper.getValidCachedUpdateFile(fileInfo,updater.logger || console);
      if (!installer) { clear(); throw Error('本地更新包缺失或校验失败，请重新下载更新'); }
      if (path.resolve(installer)!==path.resolve(helper.cacheDirForPendingUpdate,record.fileName)) throw Error('本地更新包路径无效');
      if(record.fileName.endsWith('-Update.json')&&!await require('./update-blocks.cjs').verifyInWorker({root:path.resolve(helper.cacheDir,'../..'),pending:helper.cacheDirForPendingUpdate,raw:fs.readFileSync(installer),version:record.version})){clear();await helper.clear();return null;}
      if (/\.exe$/i.test(record.fileName)&&typeof updater.verifySignature!=='function') throw Error('当前平台不支持本地更新包安装');
      const signatureError=/\.exe$/i.test(record.fileName)?await updater.verifySignature(installer):null;
      if (signatureError) { clear(); throw Error('本地更新包签名校验失败，请重新下载更新'); }
      await helper.setDownloadedFile(installer,null,{version:record.version},fileInfo,record.fileName,false);
      return {version:record.version};
    },
    async confirmInstalled(updater,currentVersion){
      const helper=await updater.getOrCreateDownloadHelper(),cache=helper.cacheDir,pending=helper.cacheDirForPendingUpdate;
      const {packageVersion,unlinkOwned,removeTree,cleanupIncrementalCache}=require('./update-cleanup.cjs');
      const {noLinks,parseManifest,digest}=require('./update-blocks.cjs');
      noLinks(pending);
      let record;try{record=JSON.parse(await fs.promises.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(record&&!valid(record))return null;
      const metadataPath=path.join(pending,'update-info.json');noLinks(metadataPath);
      let metadata;try{metadata=JSON.parse(await fs.promises.readFile(metadataPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      const metadataVersion=packageVersion(metadata?.fileName);
      const candidate=record||(metadataVersion&&{...metadata,version:metadataVersion});
      const future=candidate&&compareUpdateKeys(candidate.version,currentVersion)>0;
      // When present, verify the package of the running version before cleanup.
      // A missing package after healthy startup is safe to clean: a preceding
      // cleanup or a manual install may already have removed it.
      if(valid(candidate)&&candidate.version===currentVersion){
        const input=path.join(pending,candidate.fileName);noLinks(input);
        const stat=await fs.promises.lstat(input).catch(error=>{if(error.code!=='ENOENT')throw error;});
        if(stat){
          if(!stat.isFile()||stat.isSymbolicLink()||await sha512(input)!==candidate.sha512)throw Error('已安装更新包校验失败，保留原缓存');
          if(/\.exe$/i.test(candidate.fileName)&&(typeof updater.verifySignature!=='function'||await updater.verifySignature(input)))throw Error('已安装更新包签名校验失败，保留原缓存');
        }
      }
      let changed=false;
      // Stages survive failed downloads and are retired only after a healthy
      // startup of that version or a newer version. Future downloads stay intact.
      await cleanupIncrementalCache(cache,currentVersion);
      const remove=[];
      if(fs.existsSync(pending))for(const entry of await fs.promises.readdir(pending,{withFileTypes:true})){
        if(!entry.isFile()||entry.isSymbolicLink())continue;
        const version=packageVersion(entry.name);
        if(!version||compareUpdateKeys(version,currentVersion)>0)continue;
        // Migrate cleanup of checkpoints created by the earlier pending layout.
        if(entry.name.endsWith('-Update.json'))try{
          const raw=fs.readFileSync(path.join(pending,entry.name));parseManifest(raw,version);
          await removeTree(path.join(pending,'incremental-'+digest(raw)));
        }catch(error){if(error.code&&error.code!=='ENOENT')throw error;}
        remove.push(path.join(pending,entry.name));
      }
      for(const target of remove)changed=await unlinkOwned(target)||changed;
      for(const name of ['installer.exe','portable.zip','current.blockmap','installed-update.json'])changed=await unlinkOwned(path.join(cache,name))||changed;
      // The metadata and receipts are removed last. Every step is idempotent,
      // including a retry after the archive was deleted but metadata was locked.
      if(metadataVersion&&compareUpdateKeys(metadataVersion,currentVersion)<=0){changed=await unlinkOwned(path.join(pending,'current.blockmap'))||changed;changed=await unlinkOwned(metadataPath)||changed;}
      if(record&&compareUpdateKeys(record.version,currentVersion)<=0){clear();changed=true;}
      const attempt=readAttempt(),attemptVersion=packageVersion(attempt?.fileName);
      if(attemptVersion&&compareUpdateKeys(attemptVersion,currentVersion)<=0)await unlinkOwned(attemptFile);
      return !future&&(changed||candidate)?{version:currentVersion}:null;

    },
  };
}
module.exports={createPendingUpdate};
