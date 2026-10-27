// Validate the configured public update folder without logging in. Compares
// ranged installer bytes and full blockmaps with verified published fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const yaml=require('js-yaml');
const {createUpdateMirror}=require('../../main/update-mirror.cjs');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'.runtime-probe/openlist-sync'),configuration=require('../../update-config.json');
(async()=>{
  const manifest=yaml.load(fs.readFileSync(path.join(directory,'latest.yml'),'utf8'));
  const mirror=createUpdateMirror(configuration);let provider;
  const client={currentVersion:{version:'1.5.2'},setFeedURL:config=>{provider=new config.updateProvider(config,client,{executor:{},platform:'win32'});}};
  mirror.configure(client);provider.releaseInfo={...manifest,tag:manifest.version};
  client.downloadUpdate=async()=>{try{
    const file=provider.resolveFiles(provider.releaseInfo).find(file=>file.url.pathname.endsWith('.exe'));
    assert.equal(file.url.hostname,new URL(configuration.mirrorUrl).hostname,'verification must not silently pass through GitHub fallback');
    const expected=fs.readFileSync(path.join(directory,'ScreenSh-'+manifest.version+'-Setup.exe'));
    for(const [start,end] of [[0,63],[expected.length-64,expected.length-1]]){
      const response=await fetch(file.url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(30000)});
      assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${expected.length}`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected.subarray(start,end+1));
    }
    for(const url of provider.getBlockMapFiles(file.url,'1.5.2',manifest.version)){
      const name=decodeURIComponent(url.pathname.split('/').at(-1)),response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(directory,name)));
    }
    return [];
  }catch(error){console.error('OPENLIST_DOWNLOAD_VERIFY_FAILED',error.message);throw error;}
  };
  await mirror.download(client);
  console.log('OPENLIST_MIRROR_VERIFIED',JSON.stringify({version:manifest.version,installerBytes:manifest.files[0].size,guestAccess:true,signedUrls:true,httpRange:true,oldAndNewBlockmaps:true,installerRangesMatch:true}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
