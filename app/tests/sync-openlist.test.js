const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {syncOpenList,validateConfig}=require('../scripts/sync-openlist.cjs');
const config={schemaVersion:1,openList:{url:'https://files.example'},publish:{path:'/'}};
function fixture(t){
  const dist=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-publish-'));t.after(()=>fs.rmSync(dist,{recursive:true,force:true}));
  const name='ScreenSh-1.5.4-Setup.exe',bytes=Buffer.from('official-installer');
  fs.writeFileSync(path.join(dist,name),bytes);fs.writeFileSync(path.join(dist,name+'.blockmap'),'blockmap');
  fs.writeFileSync(path.join(dist,'latest.yml'),JSON.stringify({version:'1.5.4',files:[{url:name,size:bytes.length,sha512:crypto.createHash('sha512').update(bytes).digest('base64')}]}));
  return {dist,name};
}
test('sync verifies the installer before login, streams files in order and publishes manifest last',async t=>{
  const {dist,name}=fixture(t),uploaded=[];let last;
  await syncOpenList({config,dist,username:'publisher',password:'test-password',log:()=>{},fetchFile:async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(url.pathname==='/api/auth/login'){assert.deepEqual(JSON.parse(options.body),{username:'publisher',password:'test-password'});return Response.json({code:200,data:{token:'test-token'}});}
    assert.equal(options.headers.Authorization,'test-token');
    if(options.method==='PUT'){
      last={name:decodeURIComponent(options.headers['File-Path']).slice(1),size:0};
      for await(const chunk of options.body)last.size+=chunk.length;
      uploaded.push(last.name);assert.equal(String(last.size),options.headers['Content-Length']);
      return Response.json({code:200});
    }
    return Response.json({code:200,data:{content:[last]}});
  }});
  assert.deepEqual(uploaded,[name,name+'.blockmap','latest.yml']);
});
test('corrupt release artifacts are rejected before transmitting credentials',async t=>{
  const {dist,name}=fixture(t);fs.appendFileSync(path.join(dist,name),'corrupt');
  await assert.rejects(syncOpenList({config,dist,username:'publisher',password:'password',fetchFile:()=>{assert.fail('must not login');}}),/does not match/);
});
test('upload failure stops before publishing the manifest and does not delete historical files',async t=>{
  const {dist}=fixture(t);let calls=0;
  await assert.rejects(syncOpenList({config,dist,username:'publisher',password:'password',fetchFile:async(url,options)=>{
    calls++;if(calls===1)return Response.json({code:200,data:{token:'token'}});
    assert.equal(options.method,'PUT');await options.body.cancel();return Response.json({code:403});
  }}),/code 403/);assert.equal(calls,2);
});
test('upload configuration rejects insecure origins and paths escaping the account root',()=>{
  for(const url of ['http://files.example','https://user:password@files.example','https://files.example/?token=secret','https://files.example/other'])assert.throws(()=>validateConfig({...config,openList:{url}}));
  assert.throws(()=>validateConfig({...config,publish:{path:'/../private'}}));
});
