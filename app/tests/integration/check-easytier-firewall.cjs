// Creates only its own isolated TUN, without public peers/listeners or STUN.
// Requires elevation. Never stops another EasyTier instance.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {ManagedProcess}=require('../../main/managed-process');
const {allocateRpcPortal}=require('../../main/member-routes.cjs');
const {createEasyTierFirewall}=require('../../main/easytier-firewall.cjs');
const appRoot=path.resolve(__dirname,'../..'),root=path.join(appRoot,'.runtime-probe/firewall-lifecycle');
const firewall=createEasyTierFirewall({installRoot:root,backupDirectory:path.join(root,'backups'),warn:message=>{throw Error(message);}});
const child=new ManagedProcess('firewall fixture');
const executable=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
function count(){
  const script=`$ProgressPreference='SilentlyContinue';$r=Get-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules';@($r.PSObject.Properties|Where-Object {$_.Value -is [string] -and $_.Value -like '*|Name=EasyTier ${firewall.interfaceName} - *'}).Count`;
  return Number(execFileSync(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true}).trim());
}
(async()=>{
 fs.mkdirSync(root,{recursive:true});
 const used=Object.values(os.networkInterfaces()).flat().filter(Boolean);
 const ip=Array.from({length:20},(_,index)=>`10.254.${230+index}.1`).find(ip=>!used.some(row=>row.address.startsWith(ip.slice(0,ip.lastIndexOf('.')+1))));
 assert.ok(ip,'No isolated test subnet available');
 await firewall.cleanup();
 try{
  for(let i=0;i<2;i++){
   await child.start(path.join(appRoot,'res/easytier-core.exe'),[
    '-i',ip+'/24','--dev-name',firewall.interfaceName,'--rpc-portal',await allocateRpcPortal(),
    '--network-name',firewall.interfaceName,'--network-secret','isolated-firewall-fixture',
    '--no-listener','--disable-p2p','--disable-upnp','--disable-ipv6','--stun-servers','--stun-servers-v6',
   ],{cwd:path.join(appRoot,'res'),sensitiveValues:['isolated-firewall-fixture'],timeout:15000,
    probe:()=>Object.values(os.networkInterfaces()).flat().some(row=>row?.address===ip)});
   assert.equal(count(),8,'Exactly eight rules for the owned interface while running');
   await child.stop();
   for(let retry=0;retry<10;retry++){
    await firewall.cleanup();
    if(count()===0)break;
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   assert.equal(count(),0,'No owned interface rules left after stop');
   console.log('FIREWALL_CONNECT_STOP_OK cycle='+String(i+1));
  }
 }finally{await child.stop();await firewall.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
