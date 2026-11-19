const {normalizeRepository}=require('./updater');
const {CancellationError}=require('builder-util-runtime');
const {proxyFor,accelerateUrl,accelerateMetadataUrl,fetchMetadataText}=require('./update-acceleration.cjs');
const {updateKey,parseUpdateKey,compareUpdateKeys}=require('./update-identity.cjs');

// Version metadata and all payloads originate in the configured GitHub repository.
function createUpdateSource({repository}={},fetchFile=globalThis.fetch,{getAcceleration=()=>null}={}) {
  const repo=normalizeRepository(repository);
  if(!repo)throw Error('Invalid update repository');
  const [owner,name]=repo.split('/'),control={proxy:null};
  return {
    configure(client) {
      const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');
      class SourceProvider extends GitHubProvider {
        constructor(options,updater,runtime){super({...options,provider:'github'},updater,runtime);}
        httpRequest(url,headers,token){return super.httpRequest(url,headers,this.updater.updateCancellationToken||token);}
        createRequestOptions(url,headers){return {...super.createRequestOptions(url,headers),timeout:8000};}
        async getLatestVersion(){
          let info;
          const proxy=proxyFor(getAcceleration());
          if(proxy)try{
            const metadataUrl=new URL(`https://api.github.com/repos/${repo}/releases/latest`);
            const release=JSON.parse(await fetchMetadataText(accelerateMetadataUrl(proxy,metadataUrl,repo),fetchFile,{Accept:'application/vnd.github+json'},this.updater.updateCancellationToken));
            const tag=release.tag_name;
            if(release.draft||release.prerelease||!/^v?\d+\.\d+\.\d+$/.test(tag||''))throw Error('加速源未返回有效的正式版本');
            const manifestUrl=new URL(`https://github.com/${repo}/releases/download/${tag}/latest.yml`);
            const raw=await fetchMetadataText(accelerateMetadataUrl(proxy,manifestUrl,repo),fetchFile,{Accept:'text/yaml, text/plain, */*'},this.updater.updateCancellationToken);
            const {parseUpdateInfo}=require('electron-updater/out/providers/Provider');
            info=parseUpdateInfo(raw,'latest.yml',manifestUrl);
            const expected=`ScreenSh-${String(tag).replace(/^v/,'')}-Setup.exe`;
            if(info.version!==String(tag).replace(/^v/,'')||info.build!==undefined||info.packages||!Array.isArray(info.files)||!info.files.length||info.files.some(file=>file.url!==expected||!Number.isSafeInteger(file.size)||file.size<=0||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512||'')))throw Error('加速源更新清单与正式版本不匹配');
            if(info.portable)require('./portable-updater.cjs').portableArtifact(info);
            if(info.incremental)require('./portable-updater.cjs').incrementalArtifact(info);
            info={...info,tag,releaseName:release.name||tag,releaseNotes:release.body||''};
          }catch(error){
            if(error instanceof CancellationError||error?.name==='CancellationError'||error?.code==='ERR_UPDATER_DOWNLOAD_CANCELLED')throw error;
            info=null;
          }
          let stableError;
          try {
            if(!info)info=await super.getLatestVersion();
            // Only the direct hotfix index may advertise a same-version build.
            if(info.build!==undefined||parseUpdateKey(info.version)?.build!==1)throw Error('正式版更新身份无效');
            if(info.portable)require('./portable-updater.cjs').portableArtifact(info);
            if(info.incremental)require('./portable-updater.cjs').incrementalArtifact(info);
          } catch(error) {
            if(this.updater.updateCancellationToken?.cancelled || error instanceof CancellationError)throw error;
            stableError=error;info=null;
          }
          const currentVersion=this.updater.currentVersion.version;
          const currentBuild=this.updater.currentBuild;
          if(currentBuild!==undefined && parseUpdateKey(currentVersion) && (!info || compareUpdateKeys(info.version,currentVersion)<=0)) {
            const token=this.updater.updateCancellationToken;
            try {
              const url=new URL(`https://github.com/${repo}/releases/download/hotfix-index/ScreenSh-${currentVersion}-hotfix.json`);
              const hotfix=JSON.parse(await fetchMetadataText(url,fetchFile,{Accept:'application/json','Cache-Control':'no-cache'},token));
              const target=updateKey(hotfix);
              if(hotfix.schemaVersion!==1||hotfix.version!==currentVersion||hotfix.build<=1||compareUpdateKeys(target,updateKey({version:currentVersion,build:currentBuild}))<=0)throw Error('热修索引与当前版本不匹配');
              const {portableArtifact,incrementalArtifact}=require('./portable-updater.cjs');
              const portable=portableArtifact(hotfix),incremental=incrementalArtifact(hotfix);
              if(!portable||!incremental)throw Error('热修索引缺少更新包');
              info={version:currentVersion,build:hotfix.build,tag:`hotfix-${target}`,portable,incremental,files:[portable],releaseNotes:typeof hotfix.releaseNotes==='string'?hotfix.releaseNotes:undefined};
            }catch(error){
              if(token?.cancelled||error instanceof CancellationError)throw error;
            }
          }
          if(!info)throw stableError;
          this.releaseInfo=info;return info;
        }
        resolveFiles(info) {
          const files=super.resolveFiles(info);
          if(control.proxy)return files.map(file=>({...file,url:accelerateUrl(control.proxy,file.url)}));
          return files;
        }
        getBlockMapFiles(url,oldVersion,newVersion,override){
          const upstream=control.proxy&&url.href.startsWith(control.proxy+'/')?new URL(url.href.slice(control.proxy.length+1)):url;
          const files=super.getBlockMapFiles(upstream,oldVersion,newVersion,override);
          if(control.proxy)return files.map(file=>accelerateUrl(control.proxy,file));
          return files;
        }
      }
      client.setFeedURL({provider:'custom',updateProvider:SourceProvider,owner,repo:name});
    },
    async download(client,cancellationToken) {
      const settings=getAcceleration(),proxy=settings?proxyFor(settings):null;
      const routes=[...(proxy?[proxy]:[]),'github'];
      for(const route of routes){
        control.proxy=route==='github'?null:route;
        try{return await client.downloadUpdate(cancellationToken);}
        catch(error){
          if(error instanceof CancellationError||error?.code==='ERR_UPDATER_DOWNLOAD_CANCELLED'||error?.name==='CancellationError'||route===routes.at(-1))throw error;
        }
      }
    },
  };
}
module.exports={createUpdateSource};
