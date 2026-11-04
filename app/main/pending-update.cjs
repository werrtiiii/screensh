const fs = require('node:fs');
const path = require('node:path');
const {compareVersions} = require('./updater');
const {createHash}=require('node:crypto');
async function sha512(file){const hash=createHash('sha512');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('base64');}

// Keep only the version and verified download metadata. Installer paths are
// always resolved inside electron-updater's own pending cache.
function createPendingUpdate({file}) {
  const attemptFile=file+'.install-attempt';
  function readAttempt(){try{return JSON.parse(fs.readFileSync(attemptFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('无法读取更新安装记录，请手动覆盖安装');}}
  function clear() { try { fs.unlinkSync(file); } catch(error) { if(error.code!=='ENOENT')throw error; } }
  function valid(record) {
    return record && /^\d+\.\d+\.\d+$/.test(record.version)
      && typeof record.fileName==='string' && /^[^\\/:]+\.exe$/i.test(record.fileName)
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
      const record={version:info.version, ...metadata};
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
      if (compareVersions(record.version,currentVersion)<=0) return null;
      const helper=await updater.getOrCreateDownloadHelper();
      let cached;
      try { cached=JSON.parse(await fs.promises.readFile(path.join(helper.cacheDirForPendingUpdate,'update-info.json'),'utf8')); }
      catch { clear(); return null; }
      if (cached.fileName!==record.fileName || cached.sha512!==record.sha512) { clear(); throw Error('本地更新包信息不匹配，请重新下载更新'); }
      const fileInfo={info:{url:record.fileName,sha512:record.sha512,isAdminRightsRequired:record.isAdminRightsRequired===true}};
      const installer=await helper.getValidCachedUpdateFile(fileInfo,updater.logger || console);
      if (!installer) { clear(); throw Error('本地更新包缺失或校验失败，请重新下载更新'); }
      if (path.resolve(installer)!==path.resolve(helper.cacheDirForPendingUpdate,record.fileName)) throw Error('本地更新包路径无效');
      if (typeof updater.verifySignature!=='function') throw Error('当前平台不支持本地更新包安装');
      const signatureError=await updater.verifySignature(installer);
      if (signatureError) { clear(); throw Error('本地更新包签名校验失败，请重新下载更新'); }
      await helper.setDownloadedFile(installer,null,{version:record.version},fileInfo,record.fileName,false);
      return {version:record.version};
    },
    async confirmInstalled(updater,currentVersion){
      const helper=await updater.getOrCreateDownloadHelper(),cache=helper.cacheDir,pending=helper.cacheDirForPendingUpdate;
      if(fs.existsSync(pending)&&fs.lstatSync(pending).isSymbolicLink())throw Error('更新缓存目录不能是符号链接');
      let record;try{record=JSON.parse(await fs.promises.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(record&&!valid(record))return null;
      if(record&&compareVersions(record.version,currentVersion)>0)return null;
      let metadata;try{metadata=JSON.parse(await fs.promises.readFile(path.join(pending,'update-info.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      // Also recover receipts cleared by older clients before showing the UI.
      const match=metadata?.fileName?.match(/^ScreenSh-(\d+\.\d+\.\d+)-Setup\.exe$/);
      const candidate=record||match&&{...metadata,version:match[1]};
      if(!valid(candidate)||candidate.version!==currentVersion)return null;
      const base=path.join(cache,'installer.exe'),stage=path.join(cache,'installer.exe.new');
      const receiptFile=path.join(cache,'installed-update.json');let receipt;
      try{receipt=JSON.parse(await fs.promises.readFile(receiptFile,'utf8'));}catch{}
      const completed=receipt?.version===candidate.version&&receipt.sha512===candidate.sha512&&fs.existsSync(base)&&!fs.lstatSync(base).isSymbolicLink()&&await sha512(base)===candidate.sha512;
      if(!completed){
        if(metadata?.fileName!==candidate.fileName||metadata.sha512!==candidate.sha512)throw Error('已安装更新的缓存信息不一致，保留原缓存');
        const input=path.join(pending,candidate.fileName),stat=await fs.promises.lstat(input);
        if(!stat.isFile()||stat.isSymbolicLink()||await sha512(input)!==candidate.sha512)throw Error('已安装更新包校验失败，保留原缓存');
        if(typeof updater.verifySignature!=='function'||await updater.verifySignature(input))throw Error('已安装更新包签名校验失败，保留原缓存');
        await fs.promises.copyFile(input,stage);
        if(await sha512(stage)!==candidate.sha512)throw Error('更新基包复制校验失败，保留原缓存');
        await fs.promises.rename(stage,base);
        const map=path.join(pending,'current.blockmap'),baseMap=path.join(cache,'current.blockmap');
        if(fs.existsSync(map)&&fs.lstatSync(map).isFile()&&!fs.lstatSync(map).isSymbolicLink())await fs.promises.copyFile(map,baseMap);
        else await fs.promises.unlink(baseMap).catch(error=>{if(error.code!=='ENOENT')throw error;});
        await fs.promises.writeFile(receiptFile+'.tmp',JSON.stringify(candidate),{mode:0o600});await fs.promises.rename(receiptFile+'.tmp',receiptFile);
      }
      for(const entry of await fs.promises.readdir(pending,{withFileTypes:true})){
        if(!entry.isFile()||entry.isSymbolicLink())continue;
        const version=entry.name.match(/^(?:temp-)?ScreenSh-(\d+\.\d+\.\d+)-Setup\.exe(?:\.blockmap)?$/)?.[1];
        if(entry.name==='update-info.json'||entry.name==='current.blockmap'||version&&compareVersions(version,currentVersion)<=0)await fs.promises.unlink(path.join(pending,entry.name));
      }
      clear();await fs.promises.unlink(attemptFile).catch(error=>{if(error.code!=='ENOENT')throw error;});return {version:currentVersion,base};
    },
  };
}
module.exports={createPendingUpdate};
