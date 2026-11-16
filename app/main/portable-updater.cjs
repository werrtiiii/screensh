const { NsisUpdater } = require('electron-updater');
const fs=require('node:fs'),path=require('node:path');
const {CancellationError}=require('builder-util-runtime');
const {prepareInWorker,verifyInWorker,MAX_MANIFEST,noLinks}=require('./update-blocks.cjs');

function portableArtifact(info) {
  const file = info?.portable;
  if (!file) return null; // Transitional releases may still contain only setup.exe.
  if (file.url !== `ScreenSh-${info.version}-Update.zip` || !/^\d+\.\d+\.\d+$/.test(info.version) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '')) {
    throw Error('免安装更新包清单无效');
  }
  return file;
}

function incrementalArtifact(info){
  const file=info?.incremental;if(!file)return null;
  if(file.url!==`ScreenSh-${info.version}-Update.json`||!/^\d+\.\d+\.\d+$/.test(info.version)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_MANIFEST||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512||''))throw Error('差分更新清单无效');
  return file;
}
async function fetchUpdateRange(url,offset,length,packSize,token,fetchFile){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60000);
  const cancel=()=>abort.abort();token?.on?.('cancel',cancel);
  try{
    if(token?.cancelled)throw new CancellationError();
    const response=await fetchFile(String(url),{credentials:'omit',signal:abort.signal,headers:{Range:`bytes=${offset}-${offset+length-1}`,'Accept-Encoding':'identity'}});
    if(response.status!==206||response.headers.get('content-range')!==`bytes ${offset}-${offset+length-1}/${packSize}`||response.headers.get('content-encoding')&&!/^identity$/i.test(response.headers.get('content-encoding'))){await response.body?.cancel();throw Error('Update source does not support byte ranges');}
    const reader=response.body.getReader(),parts=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>length)throw Error('Oversized update range');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    if(size!==length)throw Error('Truncated update range');return Buffer.concat(parts);
  }finally{clearTimeout(timer);token?.removeListener?.('cancel',cancel);}
}
class PortableUpdater extends NsisUpdater {
  constructor(...args) { super(...args); this.usePortableUpdates = true; }
  async doDownloadUpdate(options) {
    const { info, provider } = options.updateInfoAndProvider;
    const artifact = portableArtifact(info);
    if (!artifact) return super.doDownloadUpdate(options);
    const incremental=incrementalArtifact(info);
    if(incremental){
      const helper=await this.getOrCreateDownloadHelper(),pending=helper.cacheDirForPendingUpdate,root=path.dirname(process.execPath);
      const cached=path.join(pending,incremental.url);noLinks(pending);
      noLinks(cached);
      if(fs.existsSync(cached)&&!await verifyInWorker({root,pending,raw:fs.readFileSync(cached),version:info.version}))await helper.clear();
      try{
        const fileInfo=provider.resolveFiles({...info,files:[incremental],packages:undefined})[0];
        return await this.executeDownload({fileExtension:'json',downloadUpdateOptions:options,fileInfo,task:async(destination,downloadOptions)=>{
          await this.httpExecutor.download(fileInfo.url,destination,{...downloadOptions,onProgress:undefined});
          if(fs.statSync(destination).size!==incremental.size)throw Error('Incremental manifest size mismatch');
          const raw=fs.readFileSync(destination),checkCancelled=()=>{if(options.cancellationToken?.cancelled)throw new CancellationError();};
          await prepareInWorker({root,pending,raw,version:info.version,checkCancelled,
            onProgress:progress=>this.emit('download-progress',progress),
            fetchRange:(pack,offset,length)=>{
              const packFile=provider.resolveFiles({...info,files:[pack],packages:undefined})[0];
              return fetchUpdateRange(packFile.url,offset,length,pack.size,options.cancellationToken,(url,init)=>require('electron').net.fetch(url,init));
            }});
          checkCancelled();
        }});
      }catch(error){
        if(options.cancellationToken?.cancelled||error instanceof CancellationError)throw new CancellationError();
        this._logger.warn('差分更新不可用，改为完整免安装更新：'+error.message);
      }
    }
    const fileInfo = provider.resolveFiles({ ...info, files: [artifact], packages: undefined })[0];
    return this.executeDownload({
      fileExtension: 'zip', downloadUpdateOptions: options, fileInfo,
      task: (destination, downloadOptions) => this.httpExecutor.download(fileInfo.url, destination, downloadOptions),
    });
  }
  doInstall(options) {
    if (/\.(zip|json)$/i.test(this.installerPath || '')) throw Error('免安装更新必须通过独立更新窗口执行');
    return super.doInstall(options);
  }
}
module.exports = { PortableUpdater, portableArtifact, incrementalArtifact, fetchUpdateRange };
