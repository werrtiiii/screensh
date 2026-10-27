const {normalizeRepository}=require('./updater');
const {CancellationError}=require('builder-util-runtime');

// Version metadata and checksums stay on GitHub. Only the artifact download
// location changes, so a stale mirror can never select an older release.
function createUpdateMirror({repository,mirrorUrl,openList,remoteSource}={},fetchFile=globalThis.fetch) {
  const repo=normalizeRepository(repository);
  if(!repo||!mirrorUrl)return null;
  let base=new URL(mirrorUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('更新镜像必须是不含密码或临时签名的 HTTPS 下载目录');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  let api;
  if(openList){api=new URL('/api/fs/get',openList.url);if(api.protocol!=='https:'||api.username||api.password||typeof openList.path!=='string'||!openList.path.startsWith('/')||openList.path.split('/').includes('..'))throw Error('OpenList 更新目录配置无效');}
  const [owner,name]=repo.split('/'),control={mirror:true};let provider;
  // Only this repository's main branch may change download locations. It cannot
  // replace the release repository or its authoritative checksums.
  const remote=remoteSource===true?`https://api.github.com/repos/${repo}/contents/update-sources.json?ref=main`:null;
  async function refreshSource(){
    if(!remote)return;
    try{
      const response=await fetchFile(remote,{credentials:'omit',headers:{Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(5000)});
      if(!response.ok||Number(response.headers?.get('content-length'))>16384)throw Error('下载源配置暂不可用');
      const reader=response.body.getReader();let size=0,chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('下载源配置过大');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(value.schemaVersion!==1)throw Error('下载源配置版本无效');
      // Reuse the exact validation used for the bundled configuration.
      if(!value.mirrorUrl)throw Error('下载源配置缺少目录');
      createUpdateMirror({repository:repo,mirrorUrl:value.mirrorUrl,openList:value.openList},fetchFile);
      base=new URL(value.mirrorUrl);if(!base.pathname.endsWith('/'))base.pathname+='/';
      openList=value.openList;api=openList?new URL('/api/fs/get',openList.url):null;
    }catch{/* Keep the last valid source, or the bundled source on first use. */}
  }
  return {
    configure(client) {
      const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');
      class MirrorProvider extends GitHubProvider {
        constructor(options,updater,runtime){super({...options,provider:'github'},updater,runtime);provider=this;this.links=new Map();}
        async getLatestVersion(){await refreshSource();const info=await super.getLatestVersion();this.releaseInfo=info;return info;}
        artifact(filename){return this.links.get(filename)||new URL(encodeURIComponent(filename),base);}
        async prepareMirror(){
          if(!api)return;
          const info=this.releaseInfo;if(!info)throw Error('请先检查更新');
          const file=super.resolveFiles(info).find(file=>file.url.pathname.endsWith('.exe'));if(!file)throw Error('安装包未发布');
          const filename=decodeURIComponent(file.url.pathname.split('/').at(-1)),current=this.updater.currentVersion?.version||String(this.updater.currentVersion);
          const names=[filename,filename+'.blockmap',(filename+'.blockmap').replace(info.version,current)];this.links.clear();
          await Promise.all([...new Set(names)].map(async name=>{
            try{
              const response=await fetchFile(api,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:openList.path.replace(/\/$/,'')+'/'+name,password:''}),signal:AbortSignal.timeout(8000)});
              if(!response.ok||response.redirected||(response.url&&new URL(response.url).origin!==api.origin))throw Error('游客更新接口不可用或发生跳转');
              const result=await response.json();if(result.code!==200||result.data?.name!==name||result.data?.is_dir)throw Error('镜像文件暂不可用');
              const url=new URL(encodeURIComponent(name),base);if(result.data.sign)url.searchParams.set('sign',result.data.sign);this.links.set(name,url);
            }catch(error){if(name===filename)throw error;}
          }));
        }
        resolveFiles(info) {
          const files=super.resolveFiles(info);
          if(!control.mirror)return files;
          return files.map(file=>{
            const filename=decodeURIComponent(file.url.pathname.split('/').at(-1));
            if(!filename||/[\\/]/.test(filename))throw Error('无效的更新文件名');
            return {...file,url:this.artifact(filename)};
          });
        }
        getBlockMapFiles(url,oldVersion,newVersion,override){
          const files=super.getBlockMapFiles(url,oldVersion,newVersion,override);
          return control.mirror?files.map(url=>this.artifact(decodeURIComponent(url.pathname.split('/').at(-1)))):files;
        }
      }
      client.setFeedURL({provider:'custom',updateProvider:MirrorProvider,owner,repo:name});
    },
    async download(client) {
      control.mirror=true;
      try{await provider?.prepareMirror();return await client.downloadUpdate();}
      catch(error){
        if(error instanceof CancellationError||error?.code==='ERR_UPDATER_DOWNLOAD_CANCELLED'||error?.name==='CancellationError')throw error;
        control.mirror=false;
        return client.downloadUpdate();
      }
    },
  };
}
module.exports={createUpdateMirror};
