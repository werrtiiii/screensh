const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNativeSignatureVerifier}=require('../main/windows-signature.cjs');
test('native signature verification requires Windows trust and the expected publisher',async()=>{
 let response={valid:true,status:0,subject:'CN=ScreenSh, O=Example, C=CN'};
 const verify=createNativeSignatureVerifier((exe,args,options,done)=>{assert.match(exe,/screensh-platform\.exe$/);assert.deepEqual(args,['verify-signature',"C:\\update's path\\setup.exe"]);done(null,JSON.stringify(response));});
 const file="C:\\update's path\\setup.exe";
 assert.equal(await verify(['CN=ScreenSh, O=Example'],file),null);assert.equal(await verify(['ScreenSh'],file),null);
 assert.match(await verify(['CN=ScreenSh, O=Wrong'],file),/不匹配/);response={valid:false,status:-1};assert.match(await verify(['ScreenSh'],file),/无效/);
});
test('unavailable native signature verification fails closed without a shell fallback',async()=>{
 const verify=createNativeSignatureVerifier((_exe,_args,_options,done)=>done(Error('denied')));await assert.rejects(verify(['ScreenSh'],'test.exe'),/denied/);
});
