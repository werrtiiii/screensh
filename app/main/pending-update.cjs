const fs = require('node:fs');
const path = require('node:path');
const {compareVersions} = require('./updater');

// Keep only the version and verified download metadata. Installer paths are
// always resolved inside electron-updater's own pending cache.
function createPendingUpdate({file}) {
  function clear() { try { fs.unlinkSync(file); } catch(error) { if(error.code!=='ENOENT')throw error; } }
  function valid(record) {
    return record && /^\d+\.\d+\.\d+$/.test(record.version)
      && typeof record.fileName==='string' && /^[^\\/:]+\.exe$/i.test(record.fileName)
      && /^[A-Za-z0-9+/]{86}==$/.test(record.sha512);
  }
  return {
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
      if (compareVersions(record.version,currentVersion)<=0) { clear(); return null; }
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
  };
}
module.exports={createPendingUpdate};
