// Exercise the bootstrap with both NSIS shell contexts, without installing ScreenSh.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','bootstrap-context-'+crypto.randomUUID());fs.mkdirSync(base,{recursive:true});
const nsis=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1'),macro=path.join(app,'build/installer-data.nsh');
async function run(context){
 const root=path.join(base,context+" 安装 ' &"),setup=path.join(base,context+'.exe'),source=path.join(base,context+'.nsi');fs.mkdirSync(path.join(root,'data'),{recursive:true});fs.writeFileSync(path.join(root,'data/profile'),'keep-profile');fs.writeFileSync(path.join(root,'data/chat'),'keep-chat');
 fs.writeFileSync(source,'\ufeff'+`Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define BUILD_RESOURCES_DIR "${path.join(app,'build')}"
!include "${macro}"
Name "ScreenSh bootstrap context fixture"
OutFile "${setup}"
InstallDir "${root}"
RequestExecutionLevel user
SilentInstall silent
Function .onInit
 SetShellVarContext ${context}
 !insertmacro customInit
FunctionEnd
Section
 FileOpen $0 "$INSTDIR\\data\\bootstrap-stage.txt" w
 FileWriteUTF16LE $0 "$EXEDIR"
 FileClose $0
SectionEnd
`);
 cp.execFileSync(path.join(nsis,'makensis.exe'),['/V2',source],{windowsHide:true,env:{...process.env,NSISDIR:nsis},stdio:'pipe'});
 cp.execFileSync(setup,['/S'],{windowsHide:true,env:{...process.env,Path:'',PATH:'',ComSpec:path.join(base,'missing-shell.exe'),PSHOME:path.join(base,'missing-interpreter')}});
 const receipt=path.join(root,'data/bootstrap-stage.txt'),deadline=Date.now()+15000;while(!fs.existsSync(receipt)){if(Date.now()>deadline)throw Error('No completed bootstrap for '+context);await new Promise(resolve=>setTimeout(resolve,50));}
 const stage=fs.readFileSync(receipt,'utf16le').replace(/^\uFEFF/,'');assert.equal(path.dirname(stage).toLowerCase(),path.join(process.env.LOCALAPPDATA,'Temp').toLowerCase());assert.match(path.basename(stage),/^ScreenSh-bootstrap-\d+\.tmp$/);
 assert.equal(fs.existsSync(path.join(stage,'native-error.log')),false);assert.equal(fs.readFileSync(path.join(root,'data/profile'),'utf8'),'keep-profile');assert.equal(fs.readFileSync(path.join(root,'data/chat'),'utf8'),'keep-chat');
 console.log('INSTALLER_BOOTSTRAP_CONTEXT_OK '+context);
}
(async()=>{await run('current');await run('all');console.log('FIXTURE '+base);})().catch(error=>{console.error(error.stack);process.exitCode=1;});
