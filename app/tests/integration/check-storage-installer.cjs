// Compile and run a tiny NSIS fixture only; never install or uninstall ScreenSh.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),probe=path.join(root,'.runtime-probe','storage-installer-check');fs.mkdirSync(probe,{recursive:true});
const nsis=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1'),compiler=path.join(nsis,'makensis.exe');
const source=fs.readFileSync(path.join(root,'node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'),'utf8');
const functions=source.match(/Function un\.(?:atomicRMDir|restoreFiles)\b[\s\S]*?FunctionEnd/g).join('\n');
assert.ok(functions.includes('Function un.restoreFiles'));
for(const updated of [false,true]){
 const directory=fs.mkdtempSync(path.join(probe,updated?'update-':'uninstall-')),install=path.join(directory,'installation');
 fs.mkdirSync(path.join(install,'data/user-data/IndexedDB'),{recursive:true});fs.mkdirSync(path.join(install,'resources'),{recursive:true});fs.writeFileSync(path.join(install,'data/user-data/IndexedDB/chat'),'keep-chat');fs.writeFileSync(path.join(install,'data/settings.json'),'keep-config');fs.writeFileSync(path.join(install,'resources/obsolete'),'remove');fs.writeFileSync(path.join(install,'program'),'remove');
 const script=path.join(directory,'fixture.nsi'),uninstaller=path.join(directory,'fixture-uninstall.exe'),setup=path.join(directory,'fixture-setup.exe');
 fs.writeFileSync(script,`!include "LogicLib.nsh"
!define isUpdated '${updated?'1 = 1':'1 = 0'}'
!define UNINSTALL_FILENAME "fixture-uninstall.exe"
!include "${path.join(root,'build/installer-data.nsh')}"
Name "ScreenSh storage test fixture"
OutFile "${setup}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
Section
WriteUninstaller "${uninstaller}"
SectionEnd
${functions}
Section "Uninstall"
!insertmacro customRemoveFiles
SectionEnd
`);
 execFileSync(compiler,['/V2',script],{stdio:'pipe',windowsHide:true,env:{...process.env,NSISDIR:nsis}});
 execFileSync(setup,['/S'],{windowsHide:true,timeout:15000});
 execFileSync(uninstaller,['/S','_?='+install],{windowsHide:true,timeout:15000});
 assert.equal(fs.readFileSync(path.join(install,'data/user-data/IndexedDB/chat'),'utf8'),'keep-chat');assert.equal(fs.readFileSync(path.join(install,'data/settings.json'),'utf8'),'keep-config');assert.equal(fs.existsSync(path.join(install,'program')),false);assert.equal(fs.existsSync(path.join(install,'resources/obsolete')),false);
 console.log(updated?'NSIS_UPDATE_PRESERVES_DATA':'NSIS_UNINSTALL_PRESERVES_DATA');
}
