const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {configureLocalStorage,configureUpdateStorage,migrateDirectory}=require('../main/local-storage.cjs');
function fixture(t){const parent=path.resolve(__dirname,'../.runtime-probe');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'storage-'));t.after(()=>{if(path.dirname(root)!==parent)throw Error('Invalid cleanup path');fs.rmSync(root,{recursive:true,force:true});});return root;}
test('moves the whole browser profile and pending updater cache into the installation data directory without deleting the source',t=>{
  const root=fixture(t),legacy=path.join(root,'roaming/screensh'),oldUpdates=path.join(root,'old-updates');
  fs.mkdirSync(path.join(legacy,'IndexedDB'),{recursive:true});fs.writeFileSync(path.join(legacy,'IndexedDB/chat'),'history');fs.writeFileSync(path.join(legacy,'settings.json'),'config');fs.mkdirSync(path.join(oldUpdates,'pending'),{recursive:true});fs.writeFileSync(path.join(oldUpdates,'pending/update-info.json'),'metadata');
  const paths={userData:legacy,exe:path.join(root,'installed/ScreenSh.exe')},env={TEMP:process.env.TEMP,TMP:process.env.TMP};t.after(()=>{for(const [k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  const app={isPackaged:true,getPath:k=>paths[k],getName:()=> 'screensh',setPath:(k,v)=>{assert.ok(fs.existsSync(v));paths[k]=v;},setAppLogsPath:p=>paths.logs=p,requestSingleInstanceLock:()=>true};
  const result=configureLocalStorage(app,{legacyUpdates:oldUpdates});
  assert.equal(result.root,path.join(root,'installed/data'));assert.equal(fs.readFileSync(path.join(paths.userData,'IndexedDB/chat'),'utf8'),'history');assert.equal(fs.readFileSync(path.join(result.updates,'pending/update-info.json'),'utf8'),'metadata');assert.ok(fs.existsSync(path.join(legacy,'settings.json')));assert.equal(paths.sessionData,paths.userData);assert.equal(process.env.TEMP,paths.temp);
  const updater={};configureUpdateStorage(updater,result.updates);assert.equal(updater.downloadedUpdateHelper.cacheDirForPendingUpdate,path.join(result.updates,'pending'));
  fs.writeFileSync(path.join(legacy,'settings.json'),'stale');migrateDirectory(legacy,result.profile);assert.equal(fs.readFileSync(path.join(result.profile,'settings.json'),'utf8'),'config');
});
test('an explicit development browser profile remains isolated and a second process never migrates data',t=>{
  const root=fixture(t),legacy=path.join(root,'legacy'),paths={userData:legacy,exe:path.join(root,'app/ScreenSh.exe')};fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'profile'),'keep');
  const app={isPackaged:false,getName:()=> 'screensh',getPath:k=>k==='appData'?root:paths[k],setPath:(k,v)=>paths[k]=v,requestSingleInstanceLock:()=>false};
  assert.equal(configureLocalStorage(app,{developmentDir:root}),null);
  app.isPackaged=true;const result=configureLocalStorage(app);assert.equal(result.hasLock,false);assert.equal(fs.existsSync(result.profile),false);
});
