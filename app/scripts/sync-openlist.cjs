const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const https=require('node:https');

function uploadStream({api,file,headers,log},request=https.request){
  return new Promise((resolve,reject)=>{
    const boundary='----ScreenSh'+crypto.randomBytes(16).toString('hex');
    const prefix=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: application/octet-stream\r\n\r\n`),suffix=Buffer.from(`\r\n--${boundary}--\r\n`);
    let input,finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);input?.destroy();if(error){req.destroy();reject(error);}else resolve(value);};
    const req=request(new URL('/api/fs/form',api),{method:'PUT',headers:{...headers,'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':String(Number(headers['Content-Length'])+prefix.length+suffix.length)}},response=>{
      let text='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{text+=chunk;if(text.length>65536)finish(Error('OpenList upload response too large'));});
      response.on('error',error=>finish(error));
      response.on('end',()=>{
        try{if(response.statusCode!==200)throw Error('OpenList upload HTTP '+response.statusCode);const result=JSON.parse(text);if(result.code!==200)throw Error('OpenList upload code '+result.code);finish(null,result.data);}catch(error){finish(error);}
      });
    });
    const timer=setTimeout(()=>finish(Error('OpenList upload total timeout')),20*60*1000);
    req.setTimeout(60000,()=>finish(Error('OpenList upload idle timeout')));
    req.on('error',error=>finish(error));
    input=fs.createReadStream(file);let transferred=0,reported=0;
    input.on('data',chunk=>{transferred+=chunk.length;if(!reported||transferred-reported>=16*1024*1024){reported=transferred;log('OpenList upload sent: '+path.basename(file)+' '+transferred+' / '+headers['Content-Length']+' bytes');}});
    input.on('error',error=>finish(error));req.write(prefix);input.on('end',()=>req.end(suffix));input.pipe(req,{end:false});
  });
}

function validateConfig(value){
  if(value?.schemaVersion!==1)throw Error('Unsupported update source schema');
  const api=new URL(value.openList?.url);
  if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw Error('Invalid OpenList API origin');
  const directory=value.publish?.path;
  if(typeof directory!=='string'||!directory.startsWith('/')||directory.split('/').includes('..'))throw Error('Invalid upload path');
  return {api,directory:directory.replace(/\/$/,'')};
}
async function syncOpenList({config,dist,username,password,fetchFile=fetch,uploadFile=uploadStream,log=console.log}){
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
  const files=[filename+'.blockmap',filename,'latest.yml'];
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
    await uploadFile({api,file,log,headers:{Authorization:login.token,'Content-Type':'application/octet-stream','Content-Length':String(size),'File-Path':encodeURIComponent(directory+'/'+name),'As-Task':'false'}});
    log('OpenList upload accepted; verifying: '+name);
    // Explicitly refresh the listing; some storage backends cache newly uploaded files.
    const listing=await request('/api/fs/list',{method:'POST',headers:{Authorization:login.token,'Content-Type':'application/json'},body:JSON.stringify({path:directory||'/',password:'',page:1,per_page:0,refresh:true}),signal:AbortSignal.timeout(60000)});
    if(!listing?.content?.some(file=>file.name===name&&file.size===size))throw Error('Uploaded file verification failed: '+name);
    log('OpenList synced: '+name+' ('+size+' bytes)');
  }
}
if(require.main===module){
  const config=JSON.parse(fs.readFileSync(process.argv[2]||path.resolve(__dirname,'../../update-sources.json'),'utf8'));
  syncOpenList({config,dist:process.argv[3]||path.resolve(__dirname,'../dist'),username:process.env.OPENLIST_USERNAME,password:process.env.OPENLIST_PASSWORD}).catch(error=>{console.error('OpenList sync failed: '+(error.message.startsWith('OpenList')?error.message:'check release files, credentials and server availability'));process.exitCode=1;});
}
module.exports={syncOpenList,validateConfig,uploadStream};
