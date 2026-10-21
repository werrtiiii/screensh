const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createEasyTierSettings}=require('../main/easytier-settings.cjs');
const schema=()=>import('../renderer/easytier-options.mjs');
test('advanced settings persist locally and reject values that could break the tunnel or inject arguments',async t=>{
  const {normalizeEasyTierSettings,easyTierAdvancedArgs,EASYTIER_OPTIONS}=await schema();const directory=fs.mkdtempSync(path.join(os.tmpdir(),'et-settings-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'settings.json'),create=()=>createEasyTierSettings({file,normalize:normalizeEasyTierSettings}),store=create();
  assert.equal(store.get().multiThread,true);assert.equal(EASYTIER_OPTIONS.length,19);assert.equal(store.get().noTun,false);
  const settings=store.set({latencyFirst:true,multiThread:false,acceptDns:true});assert.deepEqual(create().get(),settings);
  assert.throws(()=>store.set({disableP2p:'--no-tun'}),/布尔/);assert.throws(()=>store.set({noTun:true}),/TUN/);assert.deepEqual(store.get(),settings);
  const args=easyTierAdvancedArgs({...settings,untrusted:'--network-secret hacked'});assert.equal(args.length,38);assert.equal(args[args.indexOf('--latency-first')+1],'true');assert.equal(args[args.indexOf('--multi-thread')+1],'false');assert.equal(args[args.indexOf('--no-tun')+1],'false');assert.ok(!args.some(value=>value.includes('hacked')));
  fs.writeFileSync(file,'{broken');assert.throws(()=>store.get(),/无法读取/);assert.equal(fs.readFileSync(file,'utf8'),'{broken');
});
test('all advanced flags parse on the bundled EasyTier without starting a network or modifying adapters',async t=>{
  const executable=path.resolve(__dirname,'../res/easytier-core.exe');if(process.platform!=='win32'||!fs.existsSync(executable)){t.skip('Bundled Windows EasyTier unavailable');return;}
  const {EASYTIER_OPTIONS,easyTierAdvancedArgs,EASYTIER_CONNECTION_ARGS}=await schema();
  assert.equal(EASYTIER_CONNECTION_ARGS[EASYTIER_CONNECTION_ARGS.indexOf('--default-protocol')+1],'udp');
  assert.equal(EASYTIER_CONNECTION_ARGS[EASYTIER_CONNECTION_ARGS.indexOf('--p2p-only')+1],'false');
  for(const enabled of [false,true]){
    const settings=Object.fromEntries(EASYTIER_OPTIONS.map(option=>[option.key,option.unavailable?false:enabled]));
    const result=spawnSync(executable,['--config-file','-','--check-config','--network-name','screensh-config-check','--network-secret','test-only',...EASYTIER_CONNECTION_ARGS,...easyTierAdvancedArgs(settings)],{encoding:'utf8',input:'instance_name = "screensh-check"\n[network_identity]\nnetwork_name = "screensh-check"\nnetwork_secret = "test-only"\n',windowsHide:true,timeout:10000,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('ET_')))});
    assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);
  }
});
