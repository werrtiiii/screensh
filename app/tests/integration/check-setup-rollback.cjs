// Real NSIS upgrade hooks and native helpers, using disposable applications only.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','setup-rollback-'+crypto.randomUUID());
fs.mkdirSync(base,{recursive:true});
const csc=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
function compile(name,version){
  const source=path.join(base,name+'.cs'),exe=path.join(base,name+'.exe');
  fs.writeFileSync(source,`[assembly:System.Reflection.AssemblyProduct("ScreenSh")][assembly:System.Reflection.AssemblyVersion("${version}.0")]public class Fixture{public static void Main(){}}`);
  cp.execFileSync(csc,['/nologo','/target:winexe','/out:'+exe,source],{windowsHide:true});return exe;
}
const old=compile('old','1.0.0'),fresh=compile('new','9.0.0');
async function waitFor(predicate){const deadline=Date.now()+15000;while(!predicate()){if(Date.now()>deadline)throw Error('Timed out waiting for setup rollback');await new Promise(resolve=>setTimeout(resolve,50));}}
function readJournal(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(['ENOENT','EBUSY','EPERM'].includes(error.code))return {};throw error;}}
(async()=>{
  const compiler=await require('app-builder-lib/out/toolsets/windows').getMakeNsisPath();
  function makensis(name,text){const file=path.join(base,name+'.nsi');fs.writeFileSync(file,'\ufeff'+text);cp.execFileSync(compiler.path,['/V2',file],{windowsHide:true,env:{...process.env,...compiler.env},stdio:'pipe'});}
  for(const scenario of ['failed-exit','incomplete-success','wrong-version','killed','early-confirm-failure','early-confirm-success','legacy-location','second-installation','success']){
    const root=path.join(base,scenario+" 安装 ' &"),key='Software\\ScreenShRollbackTest\\'+crypto.randomUUID(),uninstallKey=key+'\\Uninstall';
    const oldRoot=['legacy-location','second-installation'].includes(scenario)?root+'-old':root;
    const setup=path.join(base,scenario+'.exe'),uninstaller=path.join(base,scenario+'-uninstall.exe'),builder=path.join(base,scenario+'-builder.exe');
    for(const install of [...new Set(scenario==='second-installation'?[root,oldRoot]:[oldRoot])]){
      fs.mkdirSync(path.join(install,'resources'),{recursive:true});fs.mkdirSync(path.join(install,'data/user-data'),{recursive:true});
      fs.copyFileSync(old,path.join(install,'ScreenSh.exe'));fs.copyFileSync(path.join(app,'res/screensh-platform.exe'),path.join(install,'resources/screensh-platform.exe'));
      fs.writeFileSync(path.join(install,'resources/old.dll'),'old-resource');fs.writeFileSync(path.join(install,'data/user-data/profile'),'keep-profile');
    }
    const headers=`Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define BUILD_RESOURCES_DIR "${path.join(app,'build')}"
!define UNINSTALL_FILENAME "Uninstall ScreenSh.exe"
!define INSTALL_REGISTRY_KEY "${key}"
!define UNINSTALL_REGISTRY_KEY "${uninstallKey}"
!define SHELL_CONTEXT HKCU
!define isUpdated '1 = 1'
`;
    makensis(scenario+'-builder',headers+`!define BUILD_UNINSTALLER
!include "${path.join(app,'build/installer-data.nsh')}"
Name "Isolated old uninstaller"
OutFile "${builder}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
Section
 WriteUninstaller "${uninstaller}"
SectionEnd
Section "Uninstall"
 SetRegView 64
 !insertmacro customCheckAppRunning
 !insertmacro customRemoveFiles
 DeleteRegKey HKCU "${uninstallKey}"
 DeleteRegKey HKCU "${key}"
SectionEnd
`);
    cp.execFileSync(builder,['/S'],{windowsHide:true});fs.copyFileSync(uninstaller,path.join(oldRoot,'Uninstall ScreenSh.exe'));
    if(scenario==='second-installation')fs.copyFileSync(uninstaller,path.join(root,'Uninstall ScreenSh.exe'));
    const uninstallerHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(oldRoot,'Uninstall ScreenSh.exe'))).digest('hex');
    makensis(scenario,headers+`!define VERSION "9.0.0"
!define UNINSTALLER_OUT_FILE "${uninstaller}"
!include "${path.join(app,'build/installer-data.nsh')}"
Name "Isolated setup rollback"
OutFile "${setup}"
InstallDir "${root}"
RequestExecutionLevel user
SilentInstall silent
Section
 SetRegView 64
 ${scenario==='legacy-location'?'':`WriteRegStr HKCU "${key}" InstallLocation "${oldRoot}"`}
 WriteRegStr HKCU "${uninstallKey}" DisplayVersion "1.0.0"
 WriteRegStr HKCU "${uninstallKey}" UninstallString \`"${oldRoot}\\Uninstall ScreenSh.exe"\`
 !insertmacro customCheckAppRunning
 CopyFiles /SILENT "${oldRoot}\\Uninstall ScreenSh.exe" "$EXEDIR\\${scenario}-invoke.exe"
 StrCpy $R2 "${oldRoot}"
 ExecWait '"$EXEDIR\\${scenario}-invoke.exe" /S --updated _?=$R2' $0
 ${scenario==='second-installation'?`CopyFiles /SILENT "$INSTDIR\\Uninstall ScreenSh.exe" "$EXEDIR\\${scenario}-second.exe"
 ExecWait '"$EXEDIR\\${scenario}-second.exe" /S --updated _?=$INSTDIR' $0`:''}
 CreateDirectory "$INSTDIR\\resources"
 FileOpen $1 "$INSTDIR\\resources\\partial.dll" w
 FileWrite $1 "partial"
 FileClose $1
 ${['success','wrong-version','early-confirm-failure','early-confirm-success'].includes(scenario)?`SetOutPath "$INSTDIR"
 File /oname=ScreenSh.exe "${scenario==='wrong-version'?old:fresh}"
 WriteRegStr HKCU "${key}" InstallLocation "$INSTDIR"
 WriteRegStr HKCU "${uninstallKey}" DisplayVersion "9.0.0"
 !ifmacrodef customInstall
  !insertmacro customInstall
 !endif
 ${scenario==='early-confirm-failure'?'Sleep 30000':scenario==='early-confirm-success'?'Sleep 1500':''}
 SetErrorLevel 0`:scenario==='killed'?'Sleep 30000':`SetErrorLevel ${['failed-exit','legacy-location','second-installation'].includes(scenario)?17:0}`}
SectionEnd
`);
    try{
      const child=cp.spawn(setup,['/S'],{windowsHide:true,stdio:'ignore'});
      const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
      if(scenario==='killed'){await waitFor(()=>fs.existsSync(path.join(root,'resources/partial.dll')));child.kill();}
      if(scenario.startsWith('early-confirm-')){
        const directory=path.join(root,'data/updates/transactions');
        await waitFor(()=>fs.existsSync(directory)&&fs.readdirSync(directory).some(name=>readJournal(path.join(directory,name,'journal.json')).phase==='applied'));
        const {confirmPortableStartup}=require('../../main/portable-confirm.cjs'),{cleanupTransactions}=require('../../main/update-cleanup.cjs');
        await cleanupTransactions(root,'9.0.0',confirmPortableStartup(root,'9.0.0'));
        if(scenario==='early-confirm-failure'){
          const tx=path.join(directory,fs.readdirSync(directory)[0]);
          const recovery=cp.spawnSync(path.join(tx,'recover.exe'),['--recover',path.join(tx,'job.json'),tx],{windowsHide:true,timeout:10000});
          child.kill();assert.equal(recovery.status,1,'Manual recovery must not run beside the live setup guard');
        }
      }
      await exited;
      const txRoot=path.join(root,'data/updates/transactions');
      if(scenario==='early-confirm-success'){
        await waitFor(()=>fs.readdirSync(txRoot).some(name=>readJournal(path.join(txRoot,name,'journal.json')).phase==='confirmed'));
        const id=fs.readdirSync(txRoot).find(name=>readJournal(path.join(txRoot,name,'journal.json')).phase==='confirmed');
        await waitFor(()=>!fs.existsSync(path.join(txRoot,id,'backup')));
        assert.deepEqual(fs.readFileSync(path.join(root,'ScreenSh.exe')),fs.readFileSync(fresh));
      }else if(scenario==='success'){
        assert.deepEqual(fs.readFileSync(path.join(root,'ScreenSh.exe')),fs.readFileSync(fresh));
        const id=fs.readdirSync(txRoot).find(name=>fs.existsSync(path.join(txRoot,name,'backup/0/ScreenSh.exe')));assert.ok(id,'Successful setup keeps the old app until startup confirmation');
        const tx=path.join(txRoot,id);await waitFor(()=>readJournal(path.join(tx,'journal.json')).phase==='awaiting-startup');
        const {confirmPortableStartup}=require('../../main/portable-confirm.cjs'),{cleanupTransactions}=require('../../main/update-cleanup.cjs');
        assert.deepEqual(confirmPortableStartup(root,'8.0.0'),[]);await cleanupTransactions(root,'8.0.0');assert.ok(fs.existsSync(path.join(tx,'backup/0/ScreenSh.exe')));
        await cleanupTransactions(root,'9.0.0',confirmPortableStartup(root,'9.0.0'));assert.equal(fs.existsSync(path.join(tx,'backup')),false);
      }else{
        await waitFor(()=>fs.existsSync(txRoot)&&fs.readdirSync(txRoot).some(name=>{
          return readJournal(path.join(txRoot,name,'journal.json')).phase==='rolled-back';
        }));
        for(const install of scenario==='second-installation'?[root,oldRoot]:[oldRoot]){
          assert.deepEqual(fs.readFileSync(path.join(install,'ScreenSh.exe')),fs.readFileSync(old));assert.equal(fs.readFileSync(path.join(install,'resources/old.dll'),'utf8'),'old-resource');
        }
        if(oldRoot===root)assert.equal(fs.existsSync(path.join(root,'resources/partial.dll')),false);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(oldRoot,'Uninstall ScreenSh.exe'))).digest('hex'),uninstallerHash);
        const registry=cp.execFileSync(path.join(process.env.SystemRoot,'System32/reg.exe'),['query','HKCU\\'+uninstallKey,'/v','DisplayVersion','/reg:64'],{windowsHide:true,encoding:'utf8'});assert.match(registry,/1\.0\.0/);
      }
      assert.equal(fs.readFileSync(path.join(oldRoot,'data/user-data/profile'),'utf8'),'keep-profile');console.log('SETUP_ROLLBACK_OK '+scenario);
    }finally{cp.spawnSync(path.join(process.env.SystemRoot,'System32/reg.exe'),['delete','HKCU\\'+key,'/f','/reg:64'],{windowsHide:true,stdio:'ignore'});}
  }
  const retryRoot=path.join(base,'retry-during-rollback'),pending=path.join(retryRoot,'data/updates/transactions',crypto.randomUUID());
  fs.mkdirSync(path.join(pending,'backup'),{recursive:true});
  fs.writeFileSync(path.join(pending,'journal.json'),JSON.stringify({root:retryRoot,version:'9.0.0',kind:'setup',phase:'rolling-back'}));
  const retry=cp.spawnSync(path.join(app,'res/screensh-platform.exe'),['prepare-setup',retryRoot,'9.0.0',String(process.pid),path.join(app,'res/screensh-updater.exe'),'Software\\ScreenShRollbackTest\\unused','Software\\ScreenShRollbackTest\\unused-uninstall',old],{windowsHide:true,encoding:'utf8'});
  assert.equal(retry.status,1);assert.match(retry.stderr,/earlier update/);assert.equal(fs.existsSync(path.join(pending,'backup')),true);
  console.log('SETUP_ROLLBACK_OK retry-during-rollback');
  console.log('FIXTURE '+base);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
