const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {noLinks}=require('./update-blocks.cjs');
async function checksum(file){const hash=crypto.createHash('sha512');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('base64');}
function createSetupFallback({spawnProcess=spawn,verifySignature=async file=>{const {readFile}=fs.promises;const yaml=require('js-yaml');const config=yaml.load(await readFile(path.join(process.resourcesPath,'app-update.yml'),'utf8'));const publishers=config?.publisherName;if(publishers==null)return;const error=await require('./windows-signature.cjs').createNativeSignatureVerifier()(Array.isArray(publishers)?publishers:[publishers],file);if(error)throw Error(error);},timeoutMs=120000,pollMs=80}={}){
 return async function launchSetupFallback({installer,sha512,version,exe,parentPid=process.pid}){
  const root=path.dirname(exe),pending=path.join(root,'data/updates/pending');
  if(!/^\d+\.\d+\.\d+$/.test(version)||path.dirname(path.resolve(installer))!==path.resolve(pending)||path.basename(installer)!==`ScreenSh-${version}-Setup.exe`||!/^[A-Za-z0-9+/]{86}==$/.test(sha512)||!Number.isSafeInteger(parentPid)||parentPid<=0)throw Error('备用安装信息无效');
  noLinks(installer);if(await checksum(installer)!==sha512)throw Error('完整安装包校验失败');
  const stage=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'Temp','ScreenSh-fallback-'+crypto.randomUUID());noLinks(stage);fs.mkdirSync(stage,{recursive:true});
  const setup=path.join(stage,'setup.exe'),ready=path.join(stage,'fallback.ready');
  const receipts=path.join(root,'data/updates/fallback-stages');noLinks(receipts);fs.mkdirSync(receipts,{recursive:true});
  fs.writeFileSync(path.join(receipts,path.basename(stage)+'.json'),JSON.stringify({stage,version,root,created:Date.now()}),{flag:'wx'});
  // The NSIS parent gate acknowledges readiness before stopping any installed process.
  // Keep its executable and TEMP outside the install root, including legacy upgrades.
  const args=['--screensh-staged','/S','--updated','--force-run',`--screensh-wait-parent=${parentPid}`,`/D=${root}`];
  let child,error,exited=false;
  const start=(command,parameters)=>{
    // NSIS requires /D= to be the final, unquoted argument even with spaces.
    child=spawnProcess(command,parameters,{detached:true,stdio:'ignore',windowsHide:true,windowsVerbatimArguments:true,cwd:stage,env:{...process.env,TEMP:stage,TMP:stage}});
    const launched=child,broker=path.basename(command).toLowerCase()==='elevate.exe';
    child.once('error',e=>{if(child===launched)error=e;});child.once('exit',code=>{if(child!==launched||broker&&code===0)return;exited=true;error=Error('安装程序未就绪便已退出（退出码 '+code+'）');});
  };
  try{
  await fs.promises.copyFile(installer,setup);if(await checksum(setup)!==sha512)throw Error('备用安装副本校验失败');await verifySignature(setup);
  start(setup,args);const deadline=Date.now()+timeoutMs;let elevated=false;
  while(!fs.existsSync(ready)){
    if(error){
      if(!elevated&&!child.pid&&['EACCES','EPERM','UNKNOWN'].includes(error.code)){
        const elevate=path.join(process.resourcesPath,'elevate.exe');if(!fs.existsSync(elevate))throw error;
        elevated=true;error=null;exited=false;start(elevate,['"'+setup+'"',...args]);
      }else throw error;
    }
    if(Date.now()>deadline){try{child.kill();}catch{}throw Error('备用安装启动超时，可能已取消权限提示；当前软件未退出。日志目录：'+stage);}
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  if(exited)throw error;child.unref();return true;
  }catch(error){fs.writeFileSync(path.join(stage,'fallback.cancel'),'cancel');try{child?.kill();}catch{}throw error;}
 };
}
module.exports={createSetupFallback,launchSetupFallback:createSetupFallback()};
