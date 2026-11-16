// Real Windows handoff with tiny fixture applications; never installs ScreenSh.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','installer-handoff-'+crypto.randomUUID());fs.mkdirSync(base,{recursive:true});
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function ps(script,args=[]){const file=path.join(base,'script-'+crypto.randomUUID()+'.ps1');fs.writeFileSync(file,'\ufeff'+script);return execFileSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...args],{windowsHide:true,encoding:'utf8'});}
function compile(code,output){const source=output+'.cs';fs.writeFileSync(source,code);ps('param($Source,$Output)\nAdd-Type -TypeDefinition ([IO.File]::ReadAllText($Source)) -OutputAssembly $Output -OutputType WindowsApplication',[source,output]);}
const fixtureApp=path.join(base,'new-app.exe');
compile('using System;using System.IO;[assembly:System.Reflection.AssemblyVersion("9.0.0.0")][assembly:System.Reflection.AssemblyFileVersion("9.0.0.0")]public class App{public static void Main(){var root=AppDomain.CurrentDomain.BaseDirectory;File.WriteAllText(Path.Combine(root,"data","opened"),"9.0.0");var tx=Path.Combine(root,"data","updates","transactions");if(Directory.Exists(tx))foreach(var dir in Directory.GetDirectories(tx)){var journal=Path.Combine(dir,"journal.json");if(File.Exists(journal)&&File.ReadAllText(journal).Contains("\\\"phase\\\":\\\"applied\\\""))File.WriteAllText(Path.Combine(dir,"confirmed"),"9.0.0");}}}',fixtureApp);
async function run(kind){
 const root=path.join(base,kind+' installation'),pending=path.join(root,'data/updates/pending');fs.mkdirSync(pending,{recursive:true});fs.mkdirSync(path.join(root,'data/user-data'));fs.mkdirSync(path.join(root,'resources'));
 fs.writeFileSync(path.join(root,'ScreenSh.exe'),'old-1.5.6');fs.writeFileSync(path.join(root,'resources/app.asar'),'old-1.5.6');fs.writeFileSync(path.join(root,'data/user-data/settings.json'),'keep-user-config');fs.writeFileSync(path.join(root,'data/user-data/chat'),'keep-chat');
 let installer;
 if(kind==='setup'){
  installer=path.join(pending,'ScreenSh-9.0.0-Setup.exe');
  compile('using System;using System.IO;using System.Linq;public class Setup{public static void Main(string[] args){var i=Array.FindIndex(args,a=>a.StartsWith("/D="));var root=string.Join(" ",args.Skip(i)).Substring(3);File.WriteAllBytes(Path.Combine(root,"ScreenSh.exe"),Convert.FromBase64String("'+fs.readFileSync(fixtureApp).toString('base64')+'"));}}',installer);
 }else{
  const source=path.join(base,'payload');fs.mkdirSync(path.join(source,'resources'),{recursive:true});fs.copyFileSync(fixtureApp,path.join(source,'ScreenSh.exe'));fs.writeFileSync(path.join(source,'resources/app.asar'),'new-9.0.0');
  const files=['ScreenSh.exe','resources/app.asar'].map(file=>{const bytes=fs.readFileSync(path.join(source,file));return {path:file,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
  fs.writeFileSync(path.join(source,'update-manifest.json'),JSON.stringify({schemaVersion:1,version:'9.0.0',files}));installer=path.join(pending,'ScreenSh-9.0.0-Update.zip');
  ps('param($Source,$Archive)\nAdd-Type -AssemblyName System.IO.Compression\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$zip=[IO.Compression.ZipFile]::Open($Archive,[IO.Compression.ZipArchiveMode]::Create)\ntry{foreach($name in @("ScreenSh.exe","resources/app.asar","update-manifest.json")){[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $Source $name),$name,[IO.Compression.CompressionLevel]::Optimal)}}finally{$zip.Dispose()}',[source,installer]);
 }
 const options={installer,sha512:crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64'),version:'9.0.0',exe:path.join(root,'ScreenSh.exe'),directory:path.join(root,'data/temp')};
 const parentScript=path.join(base,kind+'-parent.cjs');fs.writeFileSync(parentScript,'require('+JSON.stringify(path.join(app,'main/update-installer.cjs'))+').launchInstaller('+JSON.stringify(options)+').then(()=>console.log("HANDOFF_READY")).catch(e=>{console.error(e);process.exitCode=1;});');
 const parent=spawn(process.execPath,[parentScript],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,Path:'',PATH:'',ComSpec:path.join(base,'no-shell.exe'),PSModulePath:'',PSHOME:path.join(base,'no-interpreter')}});let output='',error='';parent.stdout.on('data',b=>output+=b);parent.stderr.on('data',b=>error+=b);
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{parent.kill();reject(Error('Parent did not exit after handoff'));},20000);parent.once('exit',code=>{clearTimeout(timer);resolve(code);});});assert.equal(code,0,error);assert.match(output,/HANDOFF_READY/);
 const log=path.join(root,'data/logs/update-install.log'),expected=kind==='setup'?'installed':'portable-confirmed';
 for(let i=0;i<200;i++){if(fs.existsSync(path.join(root,'data/opened'))&&fs.existsSync(log)&&fs.readFileSync(log,'utf8').includes('"stage":"'+expected+'"'))break;await sleep(100);}
 assert.ok(fs.existsSync(log),'No installation log');assert.match(fs.readFileSync(log,'utf8'),new RegExp('"stage":"'+expected+'"'));
 assert.equal(fs.readFileSync(path.join(root,'data/opened'),'utf8'),'9.0.0');assert.equal(fs.readFileSync(path.join(root,'data/user-data/settings.json'),'utf8'),'keep-user-config');assert.equal(fs.readFileSync(path.join(root,'data/user-data/chat'),'utf8'),'keep-chat');
 console.log('INDEPENDENT_INSTALLER_HANDOFF_OK '+kind);
}
(async()=>{try{await run('setup');await run('portable');console.log('FIXTURE '+base);}finally{
 ps('param($Root)\nGet-CimInstance Win32_Process | Where-Object {$_.Name -eq "powershell.exe" -and $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($Root)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}',[base]);
}})().catch(error=>{console.error(error);process.exitCode=1;});
