const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {portableArtifact,PortableUpdater}=require('../main/portable-updater.cjs');
const {confirmPortableStartup}=require('../main/portable-confirm.cjs');
const artifact={url:'ScreenSh-9.0.0-Update.zip',size:1234,sha512:'A'.repeat(86)+'=='};
test('explicit startup fallback downloads only the complete EXE through checked NSIS transport',async()=>{
 const setup={url:'ScreenSh-9.0.0-Setup.exe',size:2000,sha512:artifact.sha512};let task;
 const fake={forceFullInstaller:true,executeDownload:value=>{task=value;return Promise.resolve(['setup']);}};
 const provider={resolveFiles:info=>{assert.deepEqual(info.files,[setup]);assert.equal(info.packages,undefined);return [{url:new URL('https://github.com/owner/repo/'+setup.url),info:setup}];}};
 await PortableUpdater.prototype.doDownloadUpdate.call(fake,{updateInfoAndProvider:{info:{version:'9.0.0',files:[setup],portable:artifact},provider},disableDifferentialDownload:false});
 assert.equal(task.fileExtension,'exe');assert.equal(task.downloadUpdateOptions.disableDifferentialDownload,true);assert.equal(task.downloadUpdateOptions.disableWebInstaller,true);
});
test('portable metadata is version-bound and never accepts URLs or other package names',()=>{
 assert.equal(portableArtifact({version:'9.0.0',portable:artifact}),artifact);
 assert.equal(portableArtifact({version:'9.0.0'}),null);
 for(const value of [{...artifact,url:'../update.zip'},{...artifact,url:'https://other.example/update.zip'},{...artifact,size:-1},{...artifact,sha512:'bad'}])assert.throws(()=>portableArtifact({version:'9.0.0',portable:value}));
});
test('ZIP uses the existing checked/progress download pipeline and never invokes NSIS install',async()=>{
 let task,download;
 const fake={executeDownload:value=>{task=value;return value.task('destination',{sha512:artifact.sha512});},httpExecutor:{download:async(...args)=>{download=args;}}};
 const provider={resolveFiles:info=>{assert.deepEqual(info.files,[artifact]);return [{url:new URL('https://github.com/owner/repo/'+artifact.url),info:artifact}];}};
 await PortableUpdater.prototype.doDownloadUpdate.call(fake,{updateInfoAndProvider:{info:{version:'9.0.0',portable:artifact},provider}});
 assert.equal(task.fileExtension,'zip');assert.equal(download[2].sha512,artifact.sha512);
 assert.throws(()=>PortableUpdater.prototype.doInstall.call({installerPath:'update.zip'},{}),/独立更新/);
});
test('only a matching version in an applied transaction can confirm successful startup',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'portable-confirm-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const id='12345678-1234-1234-1234-123456789abc',dir=path.join(root,'data/updates/transactions',id);fs.mkdirSync(dir,{recursive:true});
 const journal={root,version:'9.0.0',phase:'applied'};fs.writeFileSync(path.join(dir,'journal.json'),JSON.stringify(journal));
 confirmPortableStartup(root,'8.0.0');assert.equal(fs.existsSync(path.join(dir,'confirmed')),false);
 confirmPortableStartup(root,'9.0.0');assert.equal(fs.readFileSync(path.join(dir,'confirmed'),'utf8'),'9.0.0');
});
test('only a higher build is offered within the same version and old builds cannot confirm it',async t=>{
 const updater={currentVersion:{version:'9.0.0'},currentBuild:2,isUpdateSupported:async()=>true};
 const available=build=>PortableUpdater.prototype.isUpdateAvailable.call(updater,{version:'9.0.0',build});
 assert.equal(await available(3),true);assert.equal(await available(2),false);
 updater.isUpdateSupported=async()=>false;assert.equal(await available(3),false);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'build-confirm-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data/updates/transactions/12345678-1234-1234-1234-123456789abc');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'journal.json'),JSON.stringify({root,version:'9.0.0-b3',phase:'applied'}));
 confirmPortableStartup(root,'9.0.0-b2');assert.equal(fs.existsSync(path.join(dir,'confirmed')),false);
 confirmPortableStartup(root,'9.0.0-b3');assert.equal(fs.readFileSync(path.join(dir,'confirmed'),'utf8'),'9.0.0-b3');
});
