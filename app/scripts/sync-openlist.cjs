const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');

function validateConfig(value){
  if(value?.schemaVersion!==1)throw Error('Unsupported update source schema');
  const api=new URL(value.openList?.url);
  if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw Error('Invalid OpenList API origin');
  const directory=value.publish?.path;
  if(typeof directory!=='string'||!directory.startsWith('/')||directory.split('/').includes('..'))throw Error('Invalid upload path');
  return {api,directory:directory.replace(/\/$/,'')};
}
async function syncOpenList({config,dist,username,password,fetchFile=fetch,log=console.log}){
  log('OpenList sync starting; validating release files');
  const {api,directory}=validateConfig(config);
  if(!username||!password)throw Error('OpenList upload credentials are not configured');
  const manifest=fs.readFileSync(path.join(dist,'latest.yml'),'utf8');
  const {load}=require('js-yaml'),info=load(manifest);
  const installer=info.files?.find(file=>/^ScreenSh-\d+\.\d+\.\d+-Setup\.exe$/.test(file.url));
  if(!installer||installer.url!==`ScreenSh-${info.version}-Setup.exe`)throw Error('Invalid release manifest');
  const filename=installer.url,installerPath=path.join(dist,filename),stat=fs.statSync(installerPath);
  const hash=crypto.createHash('sha512');
  for await(const chunk of fs.createReadStream(installerPath))hash.update(chunk);
  if(stat.size!==installer.size||hash.digest('base64')!==installer.sha512)throw Error('Installer does not match official release metadata');
  const files=[filename,filename+'.blockmap','latest.yml'];
  for(const name of files)if(!fs.statSync(path.join(dist,name)).isFile())throw Error('Missing release file: '+name);
  async function request(endpoint,options){
    // Reject redirects so upload credentials cannot be forwarded to another host.
    const response=await fetchFile(new URL(endpoint,api),{redirect:'error',...options});
    if(!response.ok)throw Error('OpenList HTTP '+response.status);
    const value=await response.json();if(value.code!==200)throw Error('OpenList request failed (code '+value.code+')');
    return value.data;
  }
  const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:AbortSignal.timeout(30000)});
  if(!login?.token)throw Error('OpenList did not issue an upload token');
  log('OpenList upload account authenticated');
  for(const name of files){
    const file=path.join(dist,name),size=fs.statSync(file).size;
    log('OpenList uploading: '+name+' ('+size+' bytes)');
    let transferred=0,reported=0;
    const body=Readable.toWeb(fs.createReadStream(file)).pipeThrough(new TransformStream({transform(chunk,controller){
      transferred+=chunk.byteLength;
      if(transferred-reported>=16*1024*1024){reported=transferred;log('OpenList upload progress: '+name+' '+Math.floor(transferred/size*100)+'% (sent to network)');}
      controller.enqueue(chunk);
    }}));
    await request('/api/fs/put',{method:'PUT',headers:{Authorization:login.token,'Content-Type':'application/octet-stream','Content-Length':String(size),'File-Path':encodeURIComponent(directory+'/'+name),'As-Task':'false'},body,duplex:'half',signal:AbortSignal.timeout(20*60*1000)});
    log('OpenList upload accepted; verifying: '+name);
    // Explicitly refresh the listing; some storage backends cache newly uploaded files.
    const listing=await request('/api/fs/list',{method:'POST',headers:{Authorization:login.token,'Content-Type':'application/json'},body:JSON.stringify({path:directory||'/',password:'',page:1,per_page:0,refresh:true}),signal:AbortSignal.timeout(60000)});
    if(!listing?.content?.some(file=>file.name===name&&file.size===size))throw Error('Uploaded file verification failed: '+name);
    log('OpenList synced: '+name+' ('+size+' bytes)');
  }
}
if(require.main===module){
  const config=JSON.parse(fs.readFileSync(process.argv[2]||path.resolve(__dirname,'../../update-sources.json'),'utf8'));
  syncOpenList({config,dist:process.argv[3]||path.resolve(__dirname,'../dist'),username:process.env.OPENLIST_USERNAME,password:process.env.OPENLIST_PASSWORD}).catch(()=>{console.error('OpenList sync failed. Check upload credentials, permissions and server availability.');process.exitCode=1;});
}
module.exports={syncOpenList,validateConfig};
