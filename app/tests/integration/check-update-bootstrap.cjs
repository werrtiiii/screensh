// Only runs tiny NSIS fixtures that write markers; never installs/closes ScreenSh.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const appRoot=path.resolve(__dirname,'../..'),root=path.join(appRoot,'.runtime-probe','legacy bootstrap '+process.pid),install=path.join(root,'installation');
const setup=path.join(install,'data/updates/pending/fixture.exe'),result=path.join(root,'result.txt'),log=path.join(install,'data/logs/update-install.log');
fs.mkdirSync(path.dirname(setup),{recursive:true});fs.mkdirSync(path.join(install,'data/temp'),{recursive:true});
const source=`!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define BUILD_RESOURCES_DIR "${path.join(appRoot,'build')}"
!include "${path.join(appRoot,'build/installer-data.nsh')}"
Name "Read-only update bootstrap fixture"
OutFile "${setup}"
RequestExecutionLevel user
SilentInstall silent
Function .onInit
StrCpy $INSTDIR "${install}"
!insertmacro customInit
FunctionEnd
Section
FileOpen $0 "${result}" w
FileWrite $0 "exe=$EXEPATH$\\r$\\ntemp=$TEMP$\\r$\\n"
FileClose $0
SectionEnd
`;
const script=path.join(root,'fixture.nsi'),nsis=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1');fs.writeFileSync(script,source);
execFileSync(path.join(nsis,'makensis.exe'),['/V2',script],{env:{...process.env,NSISDIR:nsis},stdio:'pipe',windowsHide:true});
execFileSync(setup,['/S','--updated'],{env:{...process.env,TEMP:path.join(install,'data/temp'),TMP:path.join(install,'data/temp')},windowsHide:true,timeout:15000});
(async()=>{
 for(let i=0;i<100&&!fs.existsSync(log);i++)await new Promise(r=>setTimeout(r,100));
 const output=fs.readFileSync(result,'utf8');assert.ok(!output.toLowerCase().includes(install.toLowerCase()));assert.match(output,/ScreenSh-bootstrap-\d+\.tmp\\setup\.exe/);
 const receipt=JSON.parse(fs.readFileSync(log,'utf8').trim());assert.equal(receipt.exitCode,0);
 console.log('LEGACY_UPDATE_EXECUTABLE_AND_TEMP_OUTSIDE_INSTALL_ROOT_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
