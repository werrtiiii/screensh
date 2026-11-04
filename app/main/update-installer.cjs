const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
async function launchInstaller({installer,sha512,version,exe,theme='light',directory,parentPid=process.pid}){
  const root=path.dirname(exe),pending=path.join(root,'data/updates/pending');
  if(path.dirname(path.resolve(installer))!==path.resolve(pending)||!/^ScreenSh-\d+\.\d+\.\d+-Setup\.exe$/.test(path.basename(installer))||!/^[A-Za-z0-9+/]{86}==$/.test(sha512)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('更新安装信息无效');
  const jobDir=path.join(directory,'install-'+randomUUID());fs.mkdirSync(jobDir,{recursive:true});
  const script=path.join(jobDir,'install.ps1'),job=path.join(jobDir,'job.json'),ready=path.join(jobDir,'ready');
  fs.writeFileSync(script,fs.readFileSync(path.join(__dirname,'update-installer.ps1')));
  fs.writeFileSync(job,JSON.stringify({installer,sha512,version,exe,root,theme,parentPid,ready,log:path.join(root,'data/logs/update-install.log')}),{mode:0o600});
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-STA','-File',script,'-JobFile',job],{detached:true,stdio:'ignore',windowsHide:true,cwd:jobDir});
  let failure;child.once('error',error=>{failure=error;});child.once('exit',code=>{failure=Error('独立更新程序已退出：'+code);});
  const deadline=Date.now()+15000;
  while(!fs.existsSync(ready)){if(failure)throw failure;if(Date.now()>deadline){child.kill();throw Error('独立更新窗口启动超时，已保留当前版本');}await new Promise(resolve=>setTimeout(resolve,80));}
  child.removeAllListeners('exit');child.unref();return true;
}
module.exports={launchInstaller};
