const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
function createInstallerLauncher({spawnProcess=spawn,timeoutMs=15000,pollMs=80}={}){
return async function launchInstaller({installer,sha512,version,exe,theme='light',directory,parentPid=process.pid}){
  const root=path.dirname(exe),pending=path.join(root,'data/updates/pending');
  if(path.dirname(path.resolve(installer))!==path.resolve(pending)||![`ScreenSh-${version}-Setup.exe`,`ScreenSh-${version}-Update.zip`,`ScreenSh-${version}-Update.json`].includes(path.basename(installer))||!/^[A-Za-z0-9+/]{86}==$/.test(sha512)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('更新安装信息无效');
  const jobDir=path.join(directory,'install-'+randomUUID());fs.mkdirSync(jobDir,{recursive:true});
  const job=path.join(jobDir,'job.json'),ready=path.join(jobDir,'ready');
  const staging=path.join(process.env.LOCALAPPDATA||require('node:os').tmpdir(),'Temp','ScreenSh-update-'+randomUUID());
  require('./update-blocks.cjs').noLinks(staging);fs.mkdirSync(staging,{recursive:true});
  const helper=path.join(staging,'screensh-updater.exe');
  fs.copyFileSync(require('./windows-helper.cjs').windowsHelper('screensh-updater.exe'),helper);
  fs.writeFileSync(job,JSON.stringify({installer,sha512,version,exe,root,theme,parentPid,ready,log:path.join(root,'data/logs/update-install.log')}),{mode:0o600});
  const startupLog=path.join(jobDir,'startup.log'),output=fs.openSync(startupLog,'a');let child;
  // The GUI executable owns its lifetime and runs outside the install root,
  // so even legacy uninstallers cannot mistake it for the old application.
  try{child=spawnProcess(helper,['--update',job],{detached:true,stdio:['ignore',output,output],windowsHide:true,cwd:staging});}
  finally{fs.closeSync(output);}
  let failure;child.once('error',error=>{failure=Error('无法启动独立更新程序：'+error.message+'。日志：'+startupLog);});child.once('exit',code=>{failure=Error('独立更新程序未就绪便已退出（退出码 '+code+'），尚未安装更新。日志：'+startupLog);});
  const deadline=Date.now()+timeoutMs;
  while(!fs.existsSync(ready)){if(failure)throw failure;if(Date.now()>deadline){child.kill();throw Error('独立更新窗口启动超时，已保留当前版本。日志：'+startupLog);}await new Promise(resolve=>setTimeout(resolve,pollMs));}
  child.removeAllListeners('exit');child.unref();return true;
}
}
module.exports={launchInstaller:createInstallerLauncher(),createInstallerLauncher};
