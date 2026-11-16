// Diagnose the immutable 1.5.6 launcher without installing or changing user data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module');
const cp=require('node:child_process');
const app=path.resolve(__dirname,'../..'),repo=path.dirname(app),base=path.join(app,'.runtime-probe','legacy-handoff-'+crypto.randomUUID());
fs.mkdirSync(base,{recursive:true});
for(const name of ['update-installer.cjs','update-installer.ps1'])fs.writeFileSync(path.join(base,name),cp.execFileSync('git',['show','1.5.6:app/main/'+name],{cwd:repo}));
const root=path.join(base,'isolated installation'),pending=path.join(root,'data/updates/pending');fs.mkdirSync(pending,{recursive:true});
const installer=path.join(pending,'ScreenSh-1.5.7-Setup.exe');fs.writeFileSync(installer,'Not executable: the test must stop before installation');
const profile=path.join(root,'data/profile.json');fs.writeFileSync(profile,'{"preserve":"original-user-data"}');
const digest=file=>crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
const originalHash=digest(profile),source=fs.readFileSync(path.join(base,'update-installer.cjs'),'utf8'),moduleObject=new Module(path.join(base,'update-installer.cjs'),module);
moduleObject.filename=path.join(base,'update-installer.cjs');moduleObject.paths=module.paths;
const normalRequire=moduleObject.require.bind(moduleObject);let child,exitCode;
moduleObject.require=name=>name==='node:child_process'?{...cp,spawn(...args){child=cp.spawn(...args);child.once('exit',code=>exitCode=code);return child;}}:normalRequire(name);
moduleObject._compile(source,moduleObject.filename);
(async()=>{
 let error=null;
 try{await moduleObject.exports.launchInstaller({installer,sha512:digest(installer),version:'1.5.7',exe:path.join(root,'ScreenSh.exe'),directory:path.join(root,'data/temp')});}catch(e){error=e.message;}
 finally{if(child?.exitCode===null)child.kill();}
 const jobs=fs.readdirSync(path.join(root,'data/temp')).filter(name=>name.startsWith('install-'));
 const result={sourceTag:'1.5.6',error,exitCode,ready:jobs.some(name=>fs.existsSync(path.join(root,'data/temp',name,'ready'))),installerStarted:fs.existsSync(path.join(root,'data/logs/update-install.log')),profileUnchanged:digest(profile)===originalHash};
 fs.writeFileSync(path.join(base,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,fixture:base}));
 assert.equal(result.profileUnchanged,true);
 assert.ok(error,'Legacy handoff succeeded here; do not claim a reproduced failure');assert.equal(result.ready,false);assert.equal(result.installerStarted,false);
 console.log('LEGACY_1_5_6_FAILURE_BEFORE_INSTALLER_REPRODUCED');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
