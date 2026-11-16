const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createEasyTierFirewall}=require('../main/easytier-firewall.cjs');
test('interface identity is stable per installation and isolated from other installations',()=>{
 const make=installRoot=>createEasyTierFirewall({installRoot,backupDirectory:path.resolve('backup'),platform:'linux'});
 assert.equal(make('A').interfaceName,make('a').interfaceName);assert.notEqual(make('A').interfaceName,make('B').interfaceName);assert.match(make('A').interfaceName,/^ScreenSh-[a-f0-9]{16}$/);
});
test('cleanup is serialized, passes literal arguments to native helper, and failures do not prevent joining',async()=>{
 const calls=[],warnings=[],firewall=createEasyTierFirewall({installRoot:'test',backupDirectory:"E:\\test's backup",platform:'win32',warn:value=>warnings.push(value),execute:(...args)=>calls.push(args)});
 const first=firewall.cleanup();assert.equal(firewall.cleanup(),first);assert.match(calls[0][0],/screensh-platform\.exe$/);assert.deepEqual(calls[0][1],['firewall',firewall.interfaceName,"E:\\test's backup",'apply']);calls[0].at(-1)(Error('access denied'),'');await first;assert.deepEqual(warnings,['access denied']);const next=firewall.cleanup();calls[1].at(-1)(null,'{"removed":0}');assert.deepEqual(await next,{removed:0});
});
test('native selector protects current/hidden adapters, program rules, duplicates and other applications',{skip:process.platform!=='win32'},t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-firewall-selector-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const rule=(adapter,bound=adapter,group='EasyTier',app='')=>({name:`EasyTier ${adapter} - TCP Protocol (Inbound)`,group,app,action:1,protocol:6,direction:1,interfaces:[bound]});
 const file=path.join(folder,'fixture.json');fs.writeFileSync(file,JSON.stringify({legacy:true,interfaceName:'',present:['et_current','{11111111-1111-1111-1111-111111111111}'],rules:[rule('et_gone','{22222222-2222-2222-2222-222222222222}'),rule('et_gone_name'),rule('et_current'),rule('et_hidden','{11111111-1111-1111-1111-111111111111}'),rule('et_other','et_other','Another app'),rule('et_program','et_program','EasyTier','other.exe'),rule('et_unbound',''),rule('et_duplicate'),rule('et_duplicate'),rule('ScreenSh-0123456789abcdef')]}));
 const result=JSON.parse(execFileSync(path.resolve(__dirname,'../res/screensh-platform.exe'),['firewall-select',file],{windowsHide:true,encoding:'utf8'}));assert.deepEqual(result.map(r=>r.adapter).sort(),['et_gone','et_gone_name']);
});
