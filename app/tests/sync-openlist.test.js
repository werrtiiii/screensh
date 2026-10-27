const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {syncOpenList,validateConfig,uploadStream}=require('../scripts/sync-openlist.cjs');
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
  await syncOpenList({config,dist,username:'publisher',password:'test-password',log:()=>{},uploadFile:async({file,headers})=>{
    last={name:decodeURIComponent(headers['File-Path']).slice(1),size:fs.statSync(file).size};uploaded.push(last.name);
    assert.equal(headers.Authorization,'test-token');assert.equal(String(last.size),headers['Content-Length']);
    assert.equal(headers.Overwrite,'true','latest.yml and retried versioned files must be overwritten');
    for(const [header,algorithm] of [['X-File-Md5','md5'],['X-File-Sha1','sha1'],['X-File-Sha256','sha256']])assert.equal(headers[header],crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex'));
  },fetchFile:async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(url.pathname==='/api/auth/login'){assert.deepEqual(JSON.parse(options.body),{username:'publisher',password:'test-password'});return Response.json({code:200,data:{token:'test-token'}});}
    assert.equal(options.headers.Authorization,'test-token');
    return Response.json({code:200,data:{content:[last]}});
  }});
  assert.deepEqual(uploaded,[name+'.blockmap',name,'latest.yml']);
});
test('corrupt release artifacts are rejected before transmitting credentials',async t=>{
  const {dist,name}=fixture(t);fs.appendFileSync(path.join(dist,name),'corrupt');
  await assert.rejects(syncOpenList({config,dist,username:'publisher',password:'password',fetchFile:()=>{assert.fail('must not login');}}),/does not match/);
});
test('upload failure stops before publishing the manifest and does not delete historical files',async t=>{
  const {dist}=fixture(t);let calls=0;
  await assert.rejects(syncOpenList({config,dist,username:'publisher',password:'password',log:()=>{},uploadFile:async()=>{calls++;throw Error('upload denied');},fetchFile:async()=>{calls++;return Response.json({code:200,data:{token:'token'}});}}),/upload denied/);assert.equal(calls,2);
});
test('native HTTPS uploader streams exact bytes and rejects HTTP redirects without forwarding credentials',async t=>{
  const {dist,name}=fixture(t),{Writable,Readable}=require('node:stream');
  let status=200,received=[];
  const request=(url,options,callback)=>{
    assert.equal(url.href,'https://files.example/api/fs/form');assert.equal(options.headers.Authorization,'test-token');
    assert.match(options.headers['Content-Type'],/^multipart\/form-data; boundary=/);
    const req=new Writable({write(chunk,encoding,done){received.push(Buffer.from(chunk));done();}});
    req.setTimeout=()=>{};
    req.on('finish',()=>{const res=Readable.from(['{"code":200}']);res.statusCode=status;callback(res);});return req;
  };
  const options={api:new URL('https://files.example'),file:path.join(dist,name),headers:{Authorization:'test-token','Content-Length':'18'},log:()=>{}};
  await uploadStream(options,request);assert.ok(Buffer.concat(received).includes(fs.readFileSync(options.file)));
  status=302;await assert.rejects(uploadStream(options,request),/HTTP 302/);
});
test('upload configuration rejects insecure origins and paths escaping the account root',()=>{
  for(const url of ['http://files.example','https://user:password@files.example','https://files.example/?token=secret','https://files.example/other'])assert.throws(()=>validateConfig({...config,openList:{url}}));
  assert.throws(()=>validateConfig({...config,publish:{path:'/../private'}}));
});
