const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeClientNetwork}=require('../main/network-config.cjs');
test('custom network selects DHCP and preserves the supplied secret while rejecting control characters and public relay targets',()=>{
const value=normalizeClientNetwork('server',{name:' existing-network ',secret:' pass with spaces ',dhcp:true,relayHost:'10.126.126.1'});
assert.deepEqual(value,{name:'existing-network',secret:' pass with spaces ',dhcp:true,relayHost:'10.126.126.1'});
for(const change of [{name:''},{secret:'bad\nvalue'},{name:'bad\u0000name'},{dhcp:'true'},{relayHost:'8.8.8.8'}])assert.throws(()=>normalizeClientNetwork('server',{...value,...change}));
assert.equal(normalizeClientNetwork('server').name,'screensh-server');assert.equal(normalizeClientNetwork('server').dhcp,false);
});
test('managed process hides custom network credentials in logs and retained output',async t=>{
const {ManagedProcess}=require('../main/managed-process');const captured=[];t.mock.method(console,'log',(...args)=>captured.push(args.join(' ')));
const secret='test-network-password',processOwner=new ManagedProcess('private-network');
try{await processOwner.start(process.execPath,['-e',`process.stdout.write('network_secret = "test-network-password"\\n');setInterval(()=>{},1000)`],{sensitiveValues:[secret],probe:()=>processOwner.output.includes('[已隐藏]'),timeout:2000});assert.equal(processOwner.output.includes(secret),false);assert.equal(captured.some(line=>line.includes(secret)),false);}finally{await processOwner.stop();}
});
