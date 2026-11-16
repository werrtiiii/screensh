// Real NSIS gate + parent process. All payloads and profiles are isolated fixtures.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','setup-fallback-'+crypto.randomUUID());fs.mkdirSync(base,{recursive:true});
const nsis=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1'),macro=path.join(app,'build/installer-data.nsh');
const setup=path.join(base,'fixture.exe'),source=path.join(base,'fixture.nsi');
fs.writeFileSync(source,'\ufeff'+`Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define BUILD_RESOURCES_DIR "${path.join(app,'build')}"
!include "${macro}"
Name "ScreenSh fallback fixture"
OutFile "${setup}"
RequestExecutionLevel user
SilentInstall silent
Function .onInit
 !insertmacro customInit
FunctionEnd
Section
 FileOpen $0 "$INSTDIR\\data\\installed" w
 FileWrite $0 "9.0.0"
 FileClose $0
SectionEnd
`);
cp.execFileSync(path.join(nsis,'makensis.exe'),['/V2',source],{windowsHide:true,env:{...process.env,NSISDIR:nsis},stdio:'pipe'});
const wait=async predicate=>{const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw Error('Fixture timeout');await new Promise(resolve=>setTimeout(resolve,30));}};
async function run(cancel){
 const root=path.join(base,(cancel?'cancel':'success')+" 中文 ' &"),pending=path.join(root,'data/updates/pending');fs.mkdirSync(pending,{recursive:true});fs.writeFileSync(path.join(root,'data/profile'),'keep-profile');fs.writeFileSync(path.join(root,'data/chat'),'keep-chat');
 const installer=path.join(pending,'ScreenSh-9.0.0-Setup.exe');fs.copyFileSync(setup,installer);const sha512=crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
 const receipt=path.join(root,'data/receipt'),release=path.join(root,'data/release'),script=path.join(root,'parent.cjs');
 fs.writeFileSync(script,`const fs=require('node:fs');let stage;
 require(${JSON.stringify(path.join(app,'main/setup-fallback.cjs'))}).createSetupFallback({verifySignature:async()=>{},spawnProcess:(cmd,args,options)=>{stage=options.cwd;return require('node:child_process').spawn(cmd,args,options);}})(${JSON.stringify({installer,sha512,version:'9.0.0',exe:path.join(root,'ScreenSh.exe')})}).then(()=>{fs.writeFileSync(${JSON.stringify(receipt)},stage);const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);process.exit(0);}},30);}).catch(e=>{console.error(e);process.exit(1);});`);
 const child=cp.spawn(process.execPath,[script],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,Path:'',PATH:'',ComSpec:path.join(base,'missing-shell.exe'),PSHOME:path.join(base,'missing-interpreter')}});let output='';child.stderr.on('data',b=>output+=b);const exit=new Promise(resolve=>child.once('exit',code=>resolve(code)));
 await wait(()=>fs.existsSync(receipt)||child.exitCode!==null);assert.ok(fs.existsSync(receipt),output);const stage=fs.readFileSync(receipt,'utf8');
 assert.equal(fs.existsSync(path.join(root,'data/installed')),false,'Setup must wait for the parent');
 if(cancel){fs.writeFileSync(path.join(stage,'fallback.cancel'),'cancel');await new Promise(resolve=>setTimeout(resolve,200));}
 fs.writeFileSync(release,'quit');assert.equal(await exit,0,output);
 if(cancel){await new Promise(resolve=>setTimeout(resolve,350));assert.equal(fs.existsSync(path.join(root,'data/installed')),false);}else{await wait(()=>fs.existsSync(path.join(root,'data/installed')));assert.equal(fs.readFileSync(path.join(root,'data/installed'),'utf8'),'9.0.0');}
 assert.equal(fs.readFileSync(path.join(root,'data/profile'),'utf8'),'keep-profile');assert.equal(fs.readFileSync(path.join(root,'data/chat'),'utf8'),'keep-chat');
 console.log(cancel?'NSIS_FALLBACK_CANCELLED_BEFORE_PARENT_EXIT_OK':'NSIS_FALLBACK_READY_WAIT_INSTALL_AND_DATA_PRESERVED_OK');
}
(async()=>{await run(false);await run(true);console.log('FIXTURE '+base);})().catch(error=>{console.error(error.stack);process.exitCode=1;});
