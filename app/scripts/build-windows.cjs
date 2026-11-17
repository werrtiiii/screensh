const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),framework=path.join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319');
const sources=['Common.cs','Platform.cs','Updater.cs','SetupUpdate.cs','Signature.cs','Program.cs'].map(file=>path.join(root,'native/windows',file));
for(const [name,target,define] of [['screensh-platform','exe','PLATFORM'],['screensh-updater','winexe','UPDATER']]){
 execFileSync(path.join(framework,'csc.exe'),['/nologo','/optimize+','/platform:x64','/target:'+target,'/define:'+define,'/win32manifest:'+path.join(root,'native/windows/helpers.manifest'),'/out:'+path.join(root,'res',name+'.exe'),'/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll','/r:System.Management.dll','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',...sources],{stdio:'inherit',windowsHide:true});
}
console.log('WINDOWS_HELPERS_BUILT');
