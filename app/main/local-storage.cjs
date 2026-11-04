const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

// Copy into a staging directory and publish only after the complete copy succeeds.
// The original remains a backup; never merge an older profile into an existing one.
function migrateDirectory(source,target){
  if(fs.existsSync(target)||!source||!fs.existsSync(source)||path.resolve(source)===path.resolve(target))return;
  const stage=target+'.migrating-'+randomUUID();
  try{
    fs.cpSync(source,stage,{recursive:true,filter:file=>!fs.lstatSync(file).isSymbolicLink()&&!/^Singleton|^lockfile$/i.test(path.basename(file))});
    fs.renameSync(stage,target);
  }catch(error){throw new Error('无法迁移本地数据，请完全退出旧客户端后重试。旧数据保持不变。'+error.message);}
}

function configureLocalStorage(app,{developmentDir,legacyUpdates}={}){
  const legacy=app.getPath('userData');
  // Test harnesses and explicit development profiles must remain isolated.
  if(!app.isPackaged&&path.resolve(legacy).toLowerCase()!==path.resolve(app.getPath('appData'),app.getName()).toLowerCase())return null;
  const root=path.join(app.isPackaged?path.dirname(app.getPath('exe')):developmentDir,'data');
  const profile=path.join(root,'user-data'),updates=path.join(root,'updates');
  try{fs.mkdirSync(root,{recursive:true});const probe=path.join(root,'.write-'+randomUUID());fs.writeFileSync(probe,'',{flag:'wx',mode:0o600});fs.unlinkSync(probe);}
  catch{throw Error('安装目录不可写，无法保存本地数据。请将软件安装到可写目录，或以管理员身份运行。');}
  // Lock the stable data root before copying the browser profile. Electron
  // requires setPath directories to exist; do not pre-create the migration target.
  app.setPath('userData',root);
  const hasLock=app.requestSingleInstanceLock();
  if(!hasLock)return {root,profile,updates,hasLock};
  migrateDirectory(legacy,profile);
  migrateDirectory(legacyUpdates,updates);
  const result={root,profile,updates,hasLock};
  for(const [key,folder]of [['userData','user-data'],['sessionData','user-data'],['temp','temp'],['downloads','downloads'],['crashDumps','crash-dumps']]){
    const directory=path.join(root,folder);fs.mkdirSync(directory,{recursive:true});app.setPath(key,directory);result[key]=directory;
  }
  const logs=path.join(root,'logs');fs.mkdirSync(logs,{recursive:true});app.setAppLogsPath(logs);
  // Native child processes also use this application's temporary directory.
  process.env.TEMP=result.temp;process.env.TMP=result.temp;
  return result;
}
function configureUpdateStorage(updater,directory){
  const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');
  updater.downloadedUpdateHelper=new DownloadedUpdateHelper(directory);
}
module.exports={configureLocalStorage,configureUpdateStorage,migrateDirectory};
