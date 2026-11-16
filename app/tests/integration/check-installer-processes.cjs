// Native image-path inspection only; never terminates real applications.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'../..'),base=path.join(app,'.runtime-probe','installer-processes-'+crypto.randomUUID()),root=path.join(base,'installation'),source=path.join(base,'fixture.cs');fs.mkdirSync(path.join(root,'data'),{recursive:true});fs.mkdirSync(path.join(base,'installation-other'));
fs.writeFileSync(source,'public class Fixture{public static void Main(){System.Threading.Thread.Sleep(60000);}}');
const binary=path.join(base,'fixture.exe');cp.execFileSync(path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/out:'+binary,source],{windowsHide:true});
const children=[];function start(file){fs.copyFileSync(binary,file);const p=cp.spawn(file,[],{windowsHide:true,stdio:'ignore'});children.push(p);return p;}
const helper=path.join(app,'res/screensh-platform.exe');
(async()=>{try{
 const owned=start(path.join(root,'ScreenSh.exe')),updater=start(path.join(root,'data/update.exe')),installer=start(path.join(root,'installer.exe')),foreign=start(path.join(base,'installation-other/ScreenSh.exe'));
 await new Promise(resolve=>setTimeout(resolve,200));
 const rows=JSON.parse(cp.execFileSync(helper,['stop-installed',root,String(installer.pid),'inspect'],{encoding:'utf8',windowsHide:true}));assert.deepEqual(rows.map(row=>row.pid),[owned.pid]);
 const exited=new Promise(resolve=>owned.once('exit',resolve));cp.execFileSync(helper,['stop-installed',root,String(installer.pid),'apply'],{windowsHide:true});await exited;
 for(const p of [updater,installer,foreign])assert.equal(p.exitCode,null);
 assert.deepEqual(JSON.parse(cp.execFileSync(helper,['stop-installed',path.join(base,'empty'),String(process.pid),'inspect'],{encoding:'utf8',windowsHide:true})),[]);
 console.log('NATIVE_INSTALLER_PROCESS_SCOPE_AND_EMPTY_INSTALL_OK');console.log('FIXTURE '+base);
}finally{for(const child of children)if(child.exitCode===null)child.kill();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
