const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process');
const {packageBlocks}=require('../../scripts/package-blocks.cjs');
const {digest,parseManifest,prepareInWorker}=require('../../main/update-blocks.cjs');
const assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../..'),fixture=path.join(app,'.runtime-probe','incremental-'+crypto.randomUUID());fs.mkdirSync(fixture,{recursive:true});
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
async function run(scenario){
  const base=path.join(fixture,scenario),root=path.join(base,'app'),source=path.join(base,'source'),pending=path.join(root,'data/updates/pending');
  for(const directory of [base,root,source,pending,path.join(source,'resources'),path.join(root,'resources')])fs.mkdirSync(directory,{recursive:true});
  const code='using System;using System.IO;public class Fixture {public static void Main(){var r=AppDomain.CurrentDomain.BaseDirectory;if(File.Exists(Path.Combine(r,"data","fail")))return;foreach(var d in Directory.GetDirectories(Path.Combine(r,"data","updates","transactions"))){if(File.ReadAllText(Path.Combine(d,"journal.json")).Contains("\\\"phase\\\":\\\"applied\\\""))File.WriteAllText(Path.Combine(d,"confirmed"),"9.0.0");}}}';
  // Pass source/output paths as parameters, rather than embedding shell strings.
  fs.writeFileSync(path.join(base,'fixture.cs'),code);
  fs.writeFileSync(path.join(base,'compile.ps1'),'param($Source,$Output)\nAdd-Type -TypeDefinition ([IO.File]::ReadAllText($Source)) -OutputAssembly $Output -OutputType WindowsApplication');
  execFileSync(powershell,['-NoProfile','-File',path.join(base,'compile.ps1'),'-Source',path.join(base,'fixture.cs'),'-Output',path.join(source,'ScreenSh.exe')],{windowsHide:true});
  fs.copyFileSync(path.join(source,'ScreenSh.exe'),path.join(root,'ScreenSh.exe'));
  fs.writeFileSync(path.join(root,'resources/app.asar'),'old');fs.writeFileSync(path.join(root,'resources/obsolete'),'obsolete');fs.writeFileSync(path.join(source,'resources/app.asar'),'new');
  fs.writeFileSync(path.join(root,'data/profile'),'keep');fs.writeFileSync(path.join(root,'Uninstall ScreenSh.exe'),'keep uninstaller');
  const files=['ScreenSh.exe','resources/app.asar'].map(name=>{const bytes=fs.readFileSync(path.join(source,name));return {path:name,size:bytes.length,sha256:digest(bytes)};});
  const artifact=await packageBlocks({source,dist:pending,version:'9.0.0',files}),raw=fs.readFileSync(path.join(pending,artifact.url)),manifest=parseManifest(raw,'9.0.0'),packed=fs.readFileSync(path.join(pending,manifest.pack.url));
  const result=await prepareInWorker({root,pending,raw,version:'9.0.0',checkCancelled(){},onProgress(){},fetchRange:async(_pack,start,length)=>packed.subarray(start,start+length)});
  assert.ok(!fs.existsSync(path.join(result.stage,'ScreenSh.exe.payload')),'unchanged executable must be reused');
  if(scenario==='startup-failure')fs.writeFileSync(path.join(root,'data/fail'),'1');
  if(scenario==='changed-base')fs.appendFileSync(path.join(root,'ScreenSh.exe'),'tampered after download');
  const before=fs.readFileSync(path.join(root,'ScreenSh.exe'));
  const job=path.join(base,'job.json');fs.writeFileSync(job,JSON.stringify({root,exe:path.join(root,'ScreenSh.exe'),installer:path.join(pending,artifact.url),sha512:artifact.sha512,version:'9.0.0'}));
  const child=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(app,'main/update-files.ps1'),'-JobFile',job],{windowsHide:true,encoding:'utf8',timeout:80000});
  if(child.error)throw child.error;
  const receipt=JSON.parse(fs.readFileSync(path.join(base,'portable-result.json'),'utf8').replace(/^\uFEFF/,''));
  assert.equal(fs.readFileSync(path.join(root,'data/profile'),'utf8'),'keep');assert.equal(fs.readFileSync(path.join(root,'Uninstall ScreenSh.exe'),'utf8'),'keep uninstaller');
  assert.deepEqual(fs.readFileSync(path.join(root,'ScreenSh.exe')),before);
  if(scenario==='success'){assert.equal(child.status,0,JSON.stringify(receipt));assert.equal(receipt.success,true);assert.equal(fs.readFileSync(path.join(root,'resources/app.asar'),'utf8'),'new');assert.equal(fs.existsSync(path.join(root,'resources/obsolete')),false);}
  else{assert.notEqual(child.status,0);assert.equal(fs.readFileSync(path.join(root,'resources/app.asar'),'utf8'),'old');if(scenario==='startup-failure')assert.equal(receipt.restored,true,JSON.stringify(receipt));}
  console.log('INCREMENTAL_TRANSACTION_OK '+scenario);
}
(async()=>{for(const scenario of ['success','startup-failure','changed-base'])await run(scenario);})().catch(error=>{console.error(error);process.exitCode=1;});
