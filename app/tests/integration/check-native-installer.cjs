// Tiny NSIS fixture: bootstrap and migrate a legacy uninstaller without a shell.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','native-installer-'+crypto.randomUUID());fs.mkdirSync(base,{recursive:true});
const root=path.join(base,"installation ' & 中文"),key='Software\\ScreenShNativeTest\\'+crypto.randomUUID();
const nsis=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1');
const csc=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
function compile(name,source){const file=path.join(base,name+'.cs'),output=path.join(base,name+'.exe');fs.writeFileSync(file,source);execFileSync(csc,['/nologo','/target:winexe','/out:'+output,file],{windowsHide:true});return output;}
function makensis(name,source){const file=path.join(base,name+'.nsi');fs.writeFileSync(file,'\ufeff'+source);execFileSync(path.join(nsis,'makensis.exe'),['/V2',file],{windowsHide:true,env:{...process.env,NSISDIR:nsis},stdio:'pipe'});}
fs.mkdirSync(path.join(root,'resources'),{recursive:true});fs.mkdirSync(path.join(root,'data/user-data'),{recursive:true});fs.writeFileSync(path.join(root,'data/user-data/profile'),'keep-profile');fs.writeFileSync(path.join(root,'data/user-data/chat'),'keep-chat');
const old=compile('old-app','[assembly:System.Reflection.AssemblyProduct("ScreenSh")]public class Fixture{public static void Main(){}}');fs.copyFileSync(old,path.join(root,'ScreenSh.exe'));
const legacyMarker=path.join(base,'legacy-uninstaller-was-called');const oldUninstaller=compile('legacy-uninstaller','public class Fixture{public static void Main(){System.IO.File.WriteAllText('+JSON.stringify(legacyMarker)+',"unexpected");System.Environment.Exit(17);}}');fs.copyFileSync(oldUninstaller,path.join(root,'Uninstall ScreenSh.exe'));
const generated=path.join(base,'native-uninstaller.exe'),builder=path.join(base,'build-uninstaller.exe'),setup=path.join(base,'fixture-setup.exe'),macro=path.join(app,'build/installer-data.nsh');
const headers=`Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define BUILD_RESOURCES_DIR "${path.join(app,'build')}"
!define UNINSTALL_FILENAME "Uninstall ScreenSh.exe"
!define INSTALL_REGISTRY_KEY "${key}"
!define SHELL_CONTEXT HKCU
!define isUpdated '1 = 1'
`;
makensis('build-uninstaller',headers+`!define BUILD_UNINSTALLER
!include "${macro}"
Name "ScreenSh native test uninstaller"
OutFile "${builder}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
Section
 WriteUninstaller "${generated}"
SectionEnd
Section "Uninstall"
 !insertmacro customCheckAppRunning
 !insertmacro customRemoveFiles
SectionEnd
`);
execFileSync(builder,['/S'],{windowsHide:true});
makensis('fixture-setup',headers+`!define UNINSTALLER_OUT_FILE "${generated}"
!include "${macro}"
Name "ScreenSh native test installer"
OutFile "${setup}"
InstallDir "${root}"
RequestExecutionLevel user
SilentInstall silent
Function .onInit
 !insertmacro customInit
FunctionEnd
Section
 WriteRegStr HKCU "${key}" InstallLocation "$INSTDIR"
 !insertmacro customCheckAppRunning
 CopyFiles /SILENT "$INSTDIR\\Uninstall ScreenSh.exe" "${path.join(base,'invoke-uninstaller.exe')}"
 ExecWait '"${path.join(base,'invoke-uninstaller.exe')}" /S _?=$INSTDIR' $0
 IntCmp $0 0 +3
 SetErrorLevel 2
 Quit
 FileOpen $1 "$INSTDIR\\data\\bootstrap-completed" w
 FileWrite $1 "native"
 FileClose $1
 DeleteRegKey HKCU "${key}"
SectionEnd
`);
(async()=>{try{
 execFileSync(setup,['/S'],{windowsHide:true,env:{...process.env,Path:'',PATH:'',ComSpec:path.join(base,'no-shell.exe'),PSModulePath:'',PSHOME:path.join(base,'no-interpreter')}});
 const complete=path.join(root,'data/bootstrap-completed');for(let i=0;i<300&&!fs.existsSync(complete);i++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(fs.readFileSync(complete,'utf8'),'native');assert.equal(fs.existsSync(legacyMarker),false);assert.equal(fs.readFileSync(path.join(root,'data/user-data/profile'),'utf8'),'keep-profile');assert.equal(fs.readFileSync(path.join(root,'data/user-data/chat'),'utf8'),'keep-chat');assert.equal(fs.existsSync(path.join(root,'ScreenSh.exe')),false);
 console.log('NATIVE_BOOTSTRAP_LEGACY_MIGRATION_AND_UNINSTALL_PRESERVE_DATA_OK');console.log('FIXTURE '+base);
}finally{spawnSync(path.join(process.env.SystemRoot,'System32/reg.exe'),['delete','HKCU\\'+key,'/f'],{windowsHide:true,stdio:'ignore'});}})().catch(error=>{console.error(error);process.exitCode=1;});
