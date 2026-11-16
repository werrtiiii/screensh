// Exercise the real custom page's leave callback with native nsDialogs controls.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','installer-path-'+crypto.randomUUID());fs.mkdirSync(base,{recursive:true});
const targets=[base,path.join(base,'not created','ScreenSh'),path.join(base,'中文 安装','ScreenSh')];
const receipt=path.join(base,'result.txt'),setup=path.join(base,'fixture.exe');
const cases=targets.map(target=>`
  \${NSD_SetText} $screenshPath "${target}"
  Call ScreenShSetupPathLeave
  StrCmp $INSTDIR "${target}" +3
    SetErrorLevel 3
    Quit
`).join('');
const source=`Unicode true
!include "MUI2.nsh"
!define VERSION "test"
!define PRODUCT_FILENAME "ScreenSh"
!define isUpdated '0 = 1'
!define SCREENSH_UI_PREVIEW_THEME "light"
!include "${path.join(app,'build/installer-ui.nsh')}"
Name "ScreenSh installation path regression"
OutFile "${setup}"
RequestExecutionLevel user
Page custom RunPathTests
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro customHeader
Function RunPathTests
  nsDialogs::Create 1018
  Pop $screenshPage
  \${NSD_CreateDirRequest} 0 0 100% 12u ""
  Pop $screenshPath
${cases}
  FileOpen $R9 "${receipt}" w
  FileWrite $R9 "OK"
  FileClose $R9
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
`;
(async()=>{
 const compiler=await require('app-builder-lib/out/toolsets/windows').getMakeNsisPath();
 const file=path.join(base,'fixture.nsi');fs.writeFileSync(file,'\ufeff'+source);
 cp.execFileSync(compiler.path,['/V2',file],{windowsHide:true,env:{...process.env,...compiler.env},stdio:'pipe'});
 cp.execFileSync(setup,[],{windowsHide:true,timeout:15000});
 assert.equal(fs.readFileSync(receipt,'utf8'),'OK');
 for(const target of targets.slice(1))assert.equal(fs.existsSync(target),false,'Path validation must not create installation directories');
 const report=path.join(base,'native-error.txt');
 const failure=cp.spawnSync(path.join(app,'res/screensh-platform.exe'),['stop-installed','',String(process.pid),'apply','--installer-report',report],{encoding:'utf8',windowsHide:true});
 assert.equal(failure.status,1);assert.equal(fs.readFileSync(report,'utf16le'),failure.stderr.trim());
 console.log('INSTALLER_EXISTING_NEW_UNICODE_PATHS_AND_UNICODE_ERROR_REPORT_OK');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
