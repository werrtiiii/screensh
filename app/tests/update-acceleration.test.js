const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createUpdateAcceleration,normalizeSettings,accelerateUrl}=require('../main/update-acceleration.cjs');
function fixture(t,fetchFile){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-acceleration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const options={file:path.join(dir,'settings.json'),repository:'werrtiiii/screensh',fetchFile};return {options,settings:createUpdateAcceleration(options)};}
test('acceleration defaults on and persists disabled and custom selections',t=>{
  const {settings,options}=fixture(t);assert.equal(settings.get().enabled,true);
  settings.set({enabled:false,source:'custom',customUrl:'https://mirror.example/prefix/'});
  assert.deepEqual(createUpdateAcceleration(options).get(),settings.get());assert.equal(settings.get().customUrl,'https://mirror.example/prefix');
  const copy=settings.get();copy.sources.length=0;assert.equal(settings.get().sources.length,4);
});
test('invalid addresses and embedded credentials never become proxy settings',()=>{
  for(const customUrl of ['http://proxy.example','https://user:secret@proxy.example','https://proxy.example/?token=secret','https://proxy.example/#fragment','not-a-url'])assert.throws(()=>normalizeSettings({enabled:true,source:'custom',customUrl}));
  assert.throws(()=>normalizeSettings({enabled:true,source:'custom',customUrl:''}));
  assert.throws(()=>accelerateUrl('https://proxy.example','https://api.github.com/repos/example/private'));
  assert.equal(accelerateUrl('https://proxy.example/prefix/','https://github.com/werrtiiii/screensh/releases/download/1.5.4/ScreenSh-1.5.4-Setup.exe').href,'https://proxy.example/prefix/https://github.com/werrtiiii/screensh/releases/download/1.5.4/ScreenSh-1.5.4-Setup.exe');
});
test('connection tests require installer bytes, distinguish HTML, and do not send credentials',async t=>{
  let requests=0;
  const {settings}=fixture(t,async(url,options)=>{
    requests++;assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);
    if(String(url).startsWith('https://api.github.com/'))return Response.json({assets:[{name:'ScreenSh-1.5.4-Setup.exe',browser_download_url:'https://github.com/werrtiiii/screensh/releases/download/1.5.4/ScreenSh-1.5.4-Setup.exe'}]});
    assert.equal(options.headers.Range,'bytes=0-63');
    if(String(url).startsWith('https://hk.'))return new Response('<html>proxy homepage</html>');
    const bytes=Buffer.alloc(64);bytes.write('MZ');return new Response(bytes,{status:206});
  });
  const results=await settings.test();assert.equal(requests,5);assert.equal(results.filter(r=>r.available).length,3);assert.equal(results.find(r=>r.source==='https://hk.gh-proxy.com').available,false);
});
test('a foreign release asset cannot be used as a probe target',async t=>{
  let requests=0;const {settings}=fixture(t,async()=>{requests++;return Response.json({assets:[{name:'ScreenSh-1.5.4-Setup.exe',browser_download_url:'https://github.com/other/repo/releases/download/1.5.4/ScreenSh-1.5.4-Setup.exe'}]});});
  await assert.rejects(settings.test(),/测试安装包/);assert.equal(requests,1);
});
