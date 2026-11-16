const {test}=require('node:test'),assert=require('node:assert/strict');
const {CancellationError}=require('builder-util-runtime');
const {createUpdateSource}=require('../main/update-source.cjs');
const info={version:'1.5.4',tag:'1.5.4',files:[{url:'ScreenSh-1.5.4-Setup.exe',size:2000,sha512:'A'.repeat(86)+'=='}]};
function fixture(settings={enabled:true,source:'https://gh-proxy.com'},fetchFile){
  const source=createUpdateSource({repository:'werrtiiii/screensh'},fetchFile,{getAcceleration:()=>settings});let provider;
  const client={currentVersion:{version:'1.5.3'},setFeedURL:config=>{provider=new config.updateProvider(config,client,{executor:{},platform:'win32'});}};
  source.configure(client);return {source,client,provider};
}
test('downloads use the selected acceleration source first, then direct GitHub',async()=>{
  const f=fixture(),urls=[];f.client.downloadUpdate=async()=>{const url=f.provider.resolveFiles(info)[0].url.href;urls.push(url);if(url.startsWith('https://gh-proxy.com/'))throw Error('offline');return 'ok';};
  assert.equal(await f.source.download(f.client),'ok');assert.equal(urls.length,2);assert.ok(urls[0].startsWith('https://gh-proxy.com/https://github.com/'));assert.ok(urls[1].startsWith('https://github.com/werrtiiii/screensh/'));
});
test('disabled acceleration never contacts a proxy, cancellation never retries',async()=>{
  for(const [settings,error] of [[{enabled:false,source:'https://gh-proxy.com'},Error('offline')],[{enabled:true,source:'https://gh-proxy.com'},new CancellationError()]]){
    const f=fixture(settings);let calls=0;f.client.downloadUpdate=async()=>{calls++;throw error;};await assert.rejects(f.source.download(f.client));assert.equal(calls,1);
  }
});
test('disabled acceleration fetches official metadata without any proxy request',async t=>{
  const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>info);
  const f=fixture({enabled:false,source:'https://gh-proxy.com'},()=>assert.fail('no extra requests'));assert.deepEqual(await f.provider.getLatestVersion(),info);
});
test('metadata uses the selected proxy first and invalid proxy metadata falls back to official GitHub',async t=>{
  let direct=0;const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>{direct++;return info;});
  const requests=[],f=fixture(undefined,async url=>{requests.push(String(url));return new Response(requests.length===1?JSON.stringify({tag_name:'1.5.4'}):require('js-yaml').dump(info));});
  const result=await f.provider.getLatestVersion();assert.equal(result.version,'1.5.4');assert.equal(result.files[0].sha512,info.files[0].sha512);assert.equal(direct,0);assert.equal(requests.length,2);assert.ok(requests.every(url=>url.startsWith('https://gh-proxy.com/https://')));
  for(const value of [{...info,version:'9.0.0'},{...info,portable:{url:'wrong.zip'}}]){
    const bad=fixture(undefined,async url=>new Response(String(url).includes('api.github.com')?JSON.stringify({tag_name:'1.5.4'}):require('js-yaml').dump(value)));assert.deepEqual(await bad.provider.getLatestVersion(),info);
  }
  assert.equal(direct,2);
});

test('successful downloads use a custom proxy for every update artifact without a direct retry',async()=>{
  const f=fixture({enabled:true,source:'custom',customUrl:'https://proxy.example/prefix'});let calls=0;
  f.client.downloadUpdate=async()=>{
    calls++;
    for(const suffix of ['Setup.exe','Update.zip','Update.json','Blocks.bin']){
      const artifact={...info.files[0],url:'ScreenSh-1.5.4-'+suffix};
      assert.equal(f.provider.resolveFiles({...info,files:[artifact]})[0].url.href,'https://proxy.example/prefix/https://github.com/werrtiiii/screensh/releases/download/1.5.4/'+artifact.url);
    }
    const url=f.provider.resolveFiles(info)[0].url;
    assert.ok(f.provider.getBlockMapFiles(url,'1.5.3','1.5.4').every(file=>file.href.startsWith('https://proxy.example/prefix/https://github.com/')));
    return 'ok';
  };
  assert.equal(await f.source.download(f.client),'ok');assert.equal(calls,1);
});

test('preference changes apply on the next download and clear the previous proxy route',async()=>{
  const settings={enabled:true,source:'https://gh-proxy.com'},f=fixture(settings),urls=[];
  f.client.downloadUpdate=async()=>{urls.push(f.provider.resolveFiles(info)[0].url.href);return 'ok';};
  await f.source.download(f.client);settings.enabled=false;await f.source.download(f.client);
  assert.ok(urls[0].startsWith('https://gh-proxy.com/'));assert.ok(urls[1].startsWith('https://github.com/'));
});

test('unavailable proxy metadata falls back to direct GitHub; cancellation never retries',async t=>{
  let direct=0;const {GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>{direct++;return info;});
  const f=fixture(undefined,async()=>{throw Error('proxy offline');});assert.deepEqual(await f.provider.getLatestVersion(),info);assert.equal(direct,1);
  const cancelled=fixture(undefined,async()=>{throw new CancellationError();});await assert.rejects(cancelled.provider.getLatestVersion(),CancellationError);assert.equal(direct,1);
});

test('failure of both metadata routes reports the direct error after the proxy attempt',async t=>{
  const order=[],{GitHubProvider}=require('electron-updater/out/providers/GitHubProvider');t.mock.method(GitHubProvider.prototype,'getLatestVersion',async()=>{order.push('direct');throw Error('direct offline');});
  const f=fixture(undefined,async()=>{order.push('proxy');throw Error('proxy offline');});
  await assert.rejects(f.provider.getLatestVersion(),/direct offline/);assert.deepEqual(order,['proxy','direct']);
});
test('metadata cancellation reaches the direct provider executor and stops proxy fallback',async()=>{
  const {CancellationToken}=require('builder-util-runtime'),token=new CancellationToken(),f=fixture({enabled:false,source:'https://gh-proxy.com'});
  f.client.updateCancellationToken=token;
  f.provider.executor.request=async(_options,cancellation)=>{assert.equal(cancellation,token);return 'direct';};
  assert.equal(await f.provider.httpRequest(new URL('https://github.com/werrtiiii/screensh/releases.atom')),'direct');
});
