const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','native-recovery-'+crypto.randomUUID());fs.mkdirSync(base,{recursive:true});
for(const unsafe of [false,true]){
 const root=path.join(base,unsafe?'unsafe':'restore'),tx=path.join(root,'data/updates/transactions',crypto.randomUUID());for(const folder of ['backup/resources','new',path.relative(tx,path.join(root,'resources'))])fs.mkdirSync(path.join(tx,folder),{recursive:true});
 const longRelative=path.join('resources','long-directory-'.repeat(5),'long-file-'.repeat(5)+'.bin');fs.mkdirSync(path.dirname(path.join(tx,'backup',longRelative)),{recursive:true});fs.writeFileSync(path.join(tx,'backup',longRelative),'long-path-data');assert.ok(path.join(tx,'backup',longRelative).length>260);
 fs.writeFileSync(path.join(tx,'backup/ScreenSh.exe'),'old-executable');fs.writeFileSync(path.join(tx,'backup/resources/app.asar'),'old-resource');fs.writeFileSync(path.join(root,'ScreenSh.exe'),'bad-new-executable');fs.writeFileSync(path.join(root,'resources/app.asar'),'bad-new-resource');fs.writeFileSync(path.join(root,'data/profile'),'keep-profile');
 fs.writeFileSync(path.join(tx,'journal.json'),JSON.stringify({root,version:'9.0.0',phase:'applying',items:[{name:'ScreenSh.exe',hadOld:true,hasNew:true},{name:unsafe?'data':'resources',hadOld:true,hasNew:true}]}));
 const job=path.join(tx,'job.json');fs.writeFileSync(job,JSON.stringify({root,exe:path.join(root,'ScreenSh.exe'),version:'9.0.0',installer:'unused',sha512:'unused'}));
 const result=spawnSync(path.join(app,'res/screensh-updater.exe'),['--recover',job,tx],{windowsHide:true,encoding:'utf8',env:{...process.env,Path:'',PATH:'',ComSpec:path.join(base,'no-shell.exe')}});
 assert.equal(fs.readFileSync(path.join(root,'data/profile'),'utf8'),'keep-profile');
 if(unsafe){assert.notEqual(result.status,0);assert.equal(fs.readFileSync(path.join(root,'ScreenSh.exe'),'utf8'),'bad-new-executable');}
 else{assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(path.join(root,'ScreenSh.exe'),'utf8'),'old-executable');assert.equal(fs.readFileSync(path.join(root,'resources/app.asar'),'utf8'),'old-resource');assert.equal(fs.readFileSync(path.join(root,longRelative),'utf8'),'long-path-data');assert.equal(JSON.parse(fs.readFileSync(path.join(tx,'journal.json'))).phase,'rolled-back');}
 console.log('NATIVE_INTERRUPTED_RECOVERY_OK '+(unsafe?'protected-data':'restore'));
}
