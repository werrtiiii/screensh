const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const https=require('node:https');
const http=require('node:http');

async function fileHashes(file){
  const hashes=Object.fromEntries(['md5','sha1','sha256','sha512'].map(name=>[name,crypto.createHash(name)]));
  for await(const chunk of fs.createReadStream(file))for(const hash of Object.values(hashes))hash.update(chunk);
  return Object.fromEntries(Object.entries(hashes).map(([name,hash])=>[name,hash.digest(name==='sha512'?'base64':'hex')]));
}

function uploadStream({api,file,headers,log,timeoutMs=90*60*1000},request){
  request??=api.protocol==='http:'?http.request:https.request;
  return new Promise((resolve,reject)=>{
    const form=Number(headers['Content-Length'])<=1024*1024;
    const boundary='----ScreenSh'+crypto.randomBytes(16).toString('hex');
    const prefix=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: application/octet-stream\r\n\r\n`),suffix=Buffer.from(`\r\n--${boundary}--\r\n`);
    let input,finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);input?.destroy();req.destroy();if(error)reject(error);else resolve(value);};
    const req=request(new URL(form?'/api/fs/form':'/api/fs/put',api),{method:'PUT',headers:form?{...headers,'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':String(Number(headers['Content-Length'])+prefix.length+suffix.length)}:headers},response=>{
      let text='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{text+=chunk;if(text.length>65536)finish(Error('OpenList upload response too large'));});
      response.on('error',error=>finish(error));
      response.on('end',()=>{
        try{if(response.statusCode!==200)throw Error('OpenList upload HTTP '+response.statusCode);const result=JSON.parse(text);if(result.code!==200)throw Error('OpenList upload code '+result.code);finish(null,result.data);}catch(error){finish(error);}
      });
    });
    const timer=setTimeout(()=>finish(Error('OpenList upload total timeout')),timeoutMs);
    req.setTimeout(60000,()=>finish(Error('OpenList upload idle timeout')));
    req.on('error',error=>finish(error));
    input=fs.createReadStream(file);let transferred=0,reported=0;
    input.on('data',chunk=>{transferred+=chunk.length;if(!reported||transferred-reported>=1024*1024){reported=transferred;log('OpenList upload sent: '+path.basename(file)+' '+transferred+' / '+headers['Content-Length']+' bytes');}});
    input.on('error',error=>finish(error));
    if(form){req.write(prefix);input.on('end',()=>req.end(suffix));input.pipe(req,{end:false});}
    else input.pipe(req);
  });
}

function validateConfig(value,publishUrl){
  if(value?.schemaVersion!==1)throw Error('Unsupported update source schema');
  // Upload credentials use a separate explicit endpoint; the guest entry may
  // redirect and is never used to discover where to send a password.
  const api=new URL(publishUrl||value.openList?.url);
  const localHttp=Boolean(publishUrl)&&api.protocol==='http:'&&['127.0.0.1','[::1]'].includes(api.hostname);
  if((api.protocol!=='https:'&&!localHttp)||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw Error('Invalid OpenList API origin');
  const directory=value.publish?.path;
  if(typeof directory!=='string'||!directory.startsWith('/')||directory.split('/').includes('..'))throw Error('Invalid upload path');
  return {api,directory:directory.replace(/\/$/,'')};
}
async function syncOpenList({config,dist,username,password,publishUrl,fetchFile=fetch,uploadFile=uploadStream,log=console.log}){
  log('OpenList sync starting; validating release files');
  const {api,directory}=validateConfig(config,publishUrl);
  if(!username||!password)throw Error('OpenList upload credentials are not configured');
  const manifest=fs.readFileSync(path.join(dist,'latest.yml'),'utf8');
  const {load}=require('js-yaml'),info=load(manifest);
  const installer=info.files?.find(file=>/^ScreenSh-\d+\.\d+\.\d+-Setup\.exe$/.test(file.url));
  if(!installer||installer.url!==`ScreenSh-${info.version}-Setup.exe`)throw Error('Invalid release manifest');
  const filename=installer.url,installerPath=path.join(dist,filename),stat=fs.statSync(installerPath);
  const verifiedHashes=await fileHashes(installerPath);
  if(stat.size!==installer.size||verifiedHashes.sha512!==installer.sha512)throw Error('Installer does not match official release metadata');
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
    const hashes=name===filename?verifiedHashes:await fileHashes(file);
    log('OpenList uploading: '+name+' ('+size+' bytes)');
    await uploadFile({api,file,log,headers:{Authorization:login.token,'Content-Type':'application/octet-stream','Content-Length':String(size),'File-Path':encodeURIComponent(directory+'/'+name),'As-Task':'false',Overwrite:'true','X-File-Md5':hashes.md5,'X-File-Sha1':hashes.sha1,'X-File-Sha256':hashes.sha256}});
    log('OpenList upload accepted; verifying: '+name);
    // Explicitly refresh the listing; some storage backends cache newly uploaded files.
    const listing=await request('/api/fs/list',{method:'POST',headers:{Authorization:login.token,'Content-Type':'application/json'},body:JSON.stringify({path:directory||'/',password:'',page:1,per_page:0,refresh:true}),signal:AbortSignal.timeout(60000)});
    if(!listing?.content?.some(file=>file.name===name&&file.size===size))throw Error('Uploaded file verification failed: '+name);
    log('OpenList synced: '+name+' ('+size+' bytes)');
  }
}
if(require.main===module){
  const config=JSON.parse(fs.readFileSync(process.argv[2]||path.resolve(__dirname,'../../update-sources.json'),'utf8'));
  syncOpenList({config,dist:process.argv[3]||path.resolve(__dirname,'../dist'),username:process.env.OPENLIST_USERNAME,password:process.env.OPENLIST_PASSWORD,publishUrl:process.env.OPENLIST_PUBLISH_URL}).catch(error=>{console.error('OpenList sync failed: '+(error.message.startsWith('OpenList')?error.message:'check release files, credentials and server availability'));process.exitCode=1;});
}
module.exports={syncOpenList,validateConfig,uploadStream};
