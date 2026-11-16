const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
async function hash(file,algorithm,encoding){const digest=crypto.createHash(algorithm);for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest(encoding);}
async function packageUpdate({source,dist,version}){
  const files=[];
  async function visit(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const full=path.join(directory,entry.name),relative=path.relative(source,full).split(path.sep).join('/');
      if(entry.isSymbolicLink()||/^data(?:\/|$)/i.test(relative)||/^uninstall/i.test(relative))throw Error('Protected or linked file in update payload: '+relative);
      if(entry.isDirectory())await visit(full);
      else if(entry.isFile())files.push({path:relative,size:fs.statSync(full).size,sha256:await hash(full,'sha256','hex')});
      else throw Error('Unsupported update entry');
    }
  }
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid update version');
  await visit(source);
  if(!files.some(file=>file.path==='ScreenSh.exe')||!files.some(file=>file.path==='resources/app.asar'))throw Error('Incomplete Windows application');
  fs.mkdirSync(dist,{recursive:true});
  const manifest={schemaVersion:1,version,files},job=path.join(dist,'portable-build.json');
  const filename=`ScreenSh-${version}-Update.zip`,archive=path.join(dist,filename),stage=archive+'.new';
  fs.writeFileSync(job,JSON.stringify({source,archive:stage,manifest}));
  try{
    const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    execFileSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'package-update.ps1'),'-JobFile',job],{stdio:'inherit',windowsHide:true});
    fs.renameSync(stage,archive);
  }finally{fs.unlinkSync(job);}
  const artifact={url:filename,size:fs.statSync(archive).size,sha512:await hash(archive,'sha512','base64')};
  const yaml=require('js-yaml'),latest=path.join(dist,'latest.yml'),info=yaml.load(fs.readFileSync(latest,'utf8'));
  if(info.version!==version)throw Error('Setup and portable versions differ');
  // Keep files/path/sha512 unchanged for already installed NSIS-only clients.
  info.portable=artifact;
  info.incremental=await require('./package-blocks.cjs').packageBlocks({source,dist,version,files});
  fs.writeFileSync(latest,yaml.dump(info,{lineWidth:-1}));
  return artifact;
}
if(require.main===module){const root=path.resolve(__dirname,'..');packageUpdate({source:path.join(root,'dist/win-unpacked'),dist:path.join(root,'dist'),version:require('../package.json').version}).then(artifact=>console.log('PORTABLE_UPDATE_PACKAGED '+artifact.url)).catch(error=>{console.error(error);process.exitCode=1;});}
module.exports={packageUpdate};
