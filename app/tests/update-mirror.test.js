const {test}=require('node:test'),assert=require('node:assert/strict');
const {CancellationError}=require('builder-util-runtime');
const {createUpdateMirror}=require('../main/update-mirror.cjs');
const info={version:'1.5.4',tag:'1.5.4',files:[{url:'ScreenSh-1.5.4-Setup.exe',size:2000,sha512:'expected-release-checksum'}]};
function fixture(options={},fetchFile,runtime){
  const mirror=createUpdateMirror({repository:'werrtiiii/screensh',mirrorUrl:'https://files.example/d/updates/',...options},fetchFile,runtime);let provider;
  const client={currentVersion:{version:'1.5.3'},setFeedURL:config=>{provider=new config.updateProvider(config,client,{executor:{},platform:'win32'});}};
  mirror.configure(client);return {mirror,client,provider};
}
test('only artifact URLs use the mirror; release version and checksum stay unchanged',()=>{
  const {provider}=fixture(),files=provider.resolveFiles(info);
  assert.equal(files[0].url.href,'https://files.example/d/updates/ScreenSh-1.5.4-Setup.exe');
  assert.deepEqual(files[0].info,info.files[0]);assert.equal(provider.isUseMultipleRangeRequest,false);
  assert.deepEqual(provider.getBlockMapFiles(files[0].url,'1.5.3','1.5.4').map(url=>url.href),[
    'https://files.example/d/updates/ScreenSh-1.5.3-Setup.exe.blockmap','https://files.example/d/updates/ScreenSh-1.5.4-Setup.exe.blockmap']);
});
test('OpenList guest lookup refreshes per-file signatures without sending login credentials',async()=>{
  const requests=[];
  const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},async(url,options)=>{
    const payload=JSON.parse(options.body);requests.push({url:String(url),options,payload});const name=payload.path.split('/').at(-1);
    return {ok:true,json:async()=>({code:200,data:{name,is_dir:false,sign:'file-specific:'+name}})};
  });
  provider.releaseInfo=info;client.downloadUpdate=async()=>provider.resolveFiles(info);
  const files=await mirror.download(client);
  assert.equal(files[0].url.searchParams.get('sign'),'file-specific:ScreenSh-1.5.4-Setup.exe');
  const maps=provider.getBlockMapFiles(files[0].url,'1.5.3','1.5.4');
  assert.equal(maps[0].searchParams.get('sign'),'file-specific:ScreenSh-1.5.3-Setup.exe.blockmap');
  assert.equal(maps[1].searchParams.get('sign'),'file-specific:ScreenSh-1.5.4-Setup.exe.blockmap');
  assert.equal(requests.length,3);
  assert.ok(requests.every(r=>r.url==='https://files.example/api/fs/get'&&r.options.redirect==='error'&&r.options.credentials==='omit'&&!r.options.headers.Authorization&&r.payload.password===''));
  await mirror.download(client);assert.equal(requests.length,6,'signatures are refreshed instead of persisted');
});
test('OpenList guest access denied falls back to GitHub without requiring credentials',async()=>{
  const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},async()=>({ok:false,json:async()=>({code:401})}));
  provider.releaseInfo=info;let calls=0;client.downloadUpdate=async()=>{calls++;return provider.resolveFiles(info);};
  const files=await mirror.download(client);assert.equal(calls,1);assert.equal(files[0].url.hostname,'github.com');
});
test('guest API redirects are rejected and fall back without requesting the administrative endpoint',async()=>{
  const requests=[];
  const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},async(url,options)=>{
    requests.push(String(url));assert.equal(options.redirect,'error');
    return new Response(null,{status:307,headers:{Location:'https://admin.example:16667/api/fs/get'}});
  });
  provider.releaseInfo=info;client.downloadUpdate=async()=>provider.resolveFiles(info);
  const files=await mirror.download(client);assert.equal(files[0].url.hostname,'github.com');
  assert.ok(requests.length>0&&requests.every(url=>url==='https://files.example/api/fs/get'));
});
test('a fetch adapter returning an already redirected guest response cannot enable the mirror',async()=>{
  const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},async()=>({ok:true,redirected:true,url:'https://admin.example:16667/api/fs/get',json:async()=>assert.fail('must reject before parsing another origin')}));
  provider.releaseInfo=info;client.downloadUpdate=async()=>provider.resolveFiles(info);
  assert.equal((await mirror.download(client))[0].url.hostname,'github.com');
});
test('a missing or invalid mirror artifact retries the same GitHub release without rechecking versions',async()=>{
  const {mirror,client,provider}=fixture(),attempts=[];
  client.downloadUpdate=async()=>{const file=provider.resolveFiles(info)[0];attempts.push(file);if(file.url.hostname==='files.example')throw Error('mirror checksum mismatch');return ['downloaded'];};
  assert.deepEqual(await mirror.download(client),['downloaded']);assert.equal(attempts.length,2);
  assert.equal(attempts[1].url.href,'https://github.com/werrtiiii/screensh/releases/download/1.5.4/ScreenSh-1.5.4-Setup.exe');
  assert.deepEqual(attempts[0].info,attempts[1].info);
  await mirror.download(client);assert.equal(attempts[2].url.hostname,'files.example','a later download tries the mirror first again');
});
test('successful mirror downloads do not contact the fallback; cancellation does not retry',async()=>{
  const {mirror,client}=fixture();let calls=0;client.downloadUpdate=async()=>{calls++;return ['mirror-file'];};
  assert.deepEqual(await mirror.download(client),['mirror-file']);assert.equal(calls,1);
  client.downloadUpdate=async()=>{calls++;throw new CancellationError();};await assert.rejects(mirror.download(client),CancellationError);assert.equal(calls,2);
});
test('mirror configuration rejects credentials, transient signatures and insecure URLs',()=>{
  for(const mirrorUrl of ['http://files.example/d/updates/','https://user:secret@files.example/','https://files.example/d/updates/?sign=secret','https://files.example/d/updates/#fragment'])assert.throws(()=>createUpdateMirror({repository:'werrtiiii/screensh',mirrorUrl}));
  assert.equal(createUpdateMirror({repository:'werrtiiii/screensh'}),null);
});
test('remote source refresh changes only download URLs and retains the last valid configuration',async t=>{
  const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');
  t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>info);
  let value={schemaVersion:1,repository:'attacker/repo',mirrorUrl:'https://new.example/download/'};
  const calls=[];
  const {provider}=fixture({remoteSource:true},async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify(value));});
  await provider.getLatestVersion();
  assert.equal(provider.resolveFiles(info)[0].url.hostname,'new.example');
  assert.equal(provider.options.owner,'werrtiiii');assert.equal(provider.options.repo,'screensh');
  assert.equal(calls[0].url,'https://api.github.com/repos/werrtiiii/screensh/contents/update-sources.json?ref=main');
  assert.equal(calls[0].options.credentials,'omit');
  value={schemaVersion:1,mirrorUrl:'https://user:secret@bad.example/'};
  await provider.getLatestVersion();assert.equal(provider.resolveFiles(info)[0].url.hostname,'new.example');
  value='x'.repeat(20000);
  await provider.getLatestVersion();assert.equal(provider.resolveFiles(info)[0].url.hostname,'new.example');
});
test('unavailable remote configuration uses bundled mirror and still checks GitHub',async t=>{
  const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');
  t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>info);
  const {provider}=fixture({remoteSource:true},async()=>{throw Error('offline');});
  assert.equal((await provider.getLatestVersion()).version,info.version);
  assert.equal(provider.resolveFiles(info)[0].url.hostname,'files.example');
});

test('failed OpenList uses the selected proxy for installer and both blockmaps, then falls back to GitHub',async()=>{
  const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},async()=>{throw Error('mirror offline');},{getAcceleration:()=>({enabled:true,source:'custom',customUrl:'https://proxy.example/prefix'})});
  provider.releaseInfo=info;const attempts=[];
  client.downloadUpdate=async()=>{const file=provider.resolveFiles(info)[0];attempts.push(file);if(attempts.length===1){assert.match(file.url.href,/^https:\/\/proxy.example\/prefix\/https:\/\/github.com\//);const maps=provider.getBlockMapFiles(file.url,'1.5.3','1.5.4');assert.ok(maps.every(u=>u.href.startsWith('https://proxy.example/prefix/https://github.com/')));assert.ok(maps[0].href.endsWith('ScreenSh-1.5.3-Setup.exe.blockmap'));throw Error('proxy checksum mismatch');}return file;};
  const file=await mirror.download(client);assert.equal(file.url.hostname,'github.com');assert.deepEqual(attempts[0].info,info.files[0]);assert.deepEqual(file.info,info.files[0]);
});
test('disabled acceleration bypasses OpenList and proxy and applies on the next download',async()=>{
  let enabled=false;const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},()=>assert.fail('disabled acceleration must not contact OpenList'),{getAcceleration:()=>({enabled,source:'https://gh-proxy.com'})});
  provider.releaseInfo=info;client.downloadUpdate=async()=>provider.resolveFiles(info);
  assert.equal((await mirror.download(client))[0].url.hostname,'github.com');
});
test('cancelled proxy download does not retry the direct source',async()=>{
  const {mirror,client,provider}=fixture({openList:{url:'https://files.example',path:'/updates'}},async()=>{throw Error('offline');},{getAcceleration:()=>({enabled:true,source:'https://gh-proxy.com'})});
  provider.releaseInfo=info;let calls=0;client.downloadUpdate=async()=>{calls++;throw new CancellationError();};
  await assert.rejects(mirror.download(client),CancellationError);assert.equal(calls,1);
});

test('official update metadata is preferred; a connection failure relays API and checksums through the selected proxy',async t=>{
  const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');let offline=false,officialCalls=0;
  t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>{officialCalls++;if(offline)throw Error('GitHub connection timed out');return info;});
  const requests=[],sha512=Buffer.alloc(64).toString('base64');
  const {provider}=fixture({},async(url,options)=>{requests.push(String(url));assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);
    if(String(url).includes('api.github.com'))return Response.json({tag_name:'1.5.4',name:'ScreenSh 1.5.4',draft:false,prerelease:false});
    return new Response(JSON.stringify({version:'1.5.4',files:[{url:'ScreenSh-1.5.4-Setup.exe',size:2000,sha512}]}));
  },{getAcceleration:()=>({enabled:true,source:'custom',customUrl:'https://proxy.example'})});
  assert.equal((await provider.getLatestVersion()).version,'1.5.4');assert.equal(requests.length,0);
  offline=true;const result=await provider.getLatestVersion();assert.equal(officialCalls,2);assert.equal(result.files[0].sha512,sha512);assert.equal(result.tag,'1.5.4');
  assert.deepEqual(requests,['https://proxy.example/https://api.github.com/repos/werrtiiii/screensh/releases/latest','https://proxy.example/https://github.com/werrtiiii/screensh/releases/download/1.5.4/latest.yml']);
  assert.equal(provider.createRequestOptions(new URL('https://github.com/werrtiiii/screensh/releases.atom')).timeout,8000);
});
test('metadata fallback rejects a mismatched version and is disabled with the acceleration switch',async t=>{
  const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>{throw Error('official offline');});
  let enabled=true,requests=0;
  const {provider}=fixture({},async()=>{requests++;return Response.json(requests===1?{tag_name:'1.5.4'}:{version:'1.5.3',files:[]});},{getAcceleration:()=>({enabled,source:'https://gh-proxy.com'})});
  await assert.rejects(provider.getLatestVersion(),/清单与正式版本不匹配/);enabled=false;await assert.rejects(provider.getLatestVersion(),/official offline/);assert.equal(requests,2);
});
