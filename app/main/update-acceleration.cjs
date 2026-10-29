const fs = require('node:fs');
const path = require('node:path');
const {normalizeRepository} = require('./updater');

const sources = ['https://edgeone.gh-proxy.com','https://hk.gh-proxy.com','https://gh-proxy.com','https://gh.dpik.top'];
const defaults = {enabled:true,source:'https://gh-proxy.com',customUrl:''};
function normalizeProxy(value) {
  if(typeof value!=='string'||value.length>2048)throw Error('请输入有效的 HTTPS 加速地址');
  let url;try{url=new URL(value.trim());}catch{throw Error('请输入有效的 HTTPS 加速地址');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('加速地址必须使用 HTTPS，不能包含账号、密码或查询参数');
  return url.href.replace(/\/+$/,'');
}
function normalizeSettings(value) {
  if(!value||typeof value.enabled!=='boolean'||!['custom',...sources].includes(value.source)||typeof value.customUrl!=='string')throw Error('下载加速设置无效');
  const customUrl=value.customUrl.trim()?normalizeProxy(value.customUrl):'';
  if(value.enabled&&value.source==='custom'&&!customUrl)throw Error('请填写自定义加速地址');
  return {enabled:value.enabled,source:value.source,customUrl};
}
function proxyFor(value) {return value?.enabled?normalizeProxy(value.source==='custom'?value.customUrl:value.source):null;}
function accelerateUrl(proxy,original) {
  const url=new URL(original);
  if(url.origin!=='https://github.com'||!/^\/[^/]+\/[^/]+\/releases\/download\//.test(url.pathname)||url.username||url.password)throw Error('只支持加速 GitHub 正式发行文件');
  return new URL(normalizeProxy(proxy)+'/'+url.href);
}
async function readBody(response,limit,truncate=false) {
  if(!response.body)throw Error('响应内容为空');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;
    if(size+value.length>limit&&!truncate)throw Error('响应内容过大');
    const part=value.subarray(0,limit-size);chunks.push(Buffer.from(part));size+=part.length;if(truncate&&size>=limit)break;
  }}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
function createUpdateAcceleration({file,repository,fetchFile=fetch,now=Date.now}) {
  let settings={...defaults},testing;
  try{settings=normalizeSettings(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}
  const repo=normalizeRepository(repository);
  async function test(customUrl='') {
    const candidates=[...sources];if(customUrl.trim())candidates.push(normalizeProxy(customUrl));
    if(!repo)throw Error('未配置 GitHub 更新仓库');
    const response=await fetchFile(`https://api.github.com/repos/${repo}/releases/latest`,{credentials:'omit',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('无法获取 GitHub 测试文件，请稍后重试');
    const release=JSON.parse((await readBody(response,131072)).toString('utf8'));
    const installer=release.assets?.find(a=>/^ScreenSh-\d+\.\d+\.\d+-Setup\.exe$/.test(a.name||''));
    const original=new URL(installer?.browser_download_url||'https://invalid.example');
    if(original.origin!=='https://github.com'||!original.pathname.startsWith('/'+repo+'/releases/download/'))throw Error('GitHub 暂无可用测试安装包');
    return Promise.all([...new Set(candidates)].map(async source=>{
      const start=now();try{
        const result=await fetchFile(accelerateUrl(source,original),{credentials:'omit',headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(8000)});
        if(![200,206].includes(result.status)){await result.body?.cancel().catch(()=>{});throw Error('无法下载');}
        const bytes=await readBody(result,64,true);
        if(bytes.length!==64||bytes[0]!==0x4d||bytes[1]!==0x5a)throw Error('返回内容不是安装包');
        return {source,available:true,latency:Math.max(0,Math.round(now()-start)),range:result.status===206};
      }catch{return {source,available:false,latency:null};}
    }));
  }
  return {
    get:()=>({...settings,sources:[...sources]}),
    set(value){const next=normalizeSettings(value);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(file+'.tmp',file);settings=next;return this.get();},
    test(customUrl=''){if(typeof customUrl!=='string')return Promise.reject(Error('自定义加速地址无效'));if(!testing)testing=test(customUrl).finally(()=>{testing=null;});return testing;},
  };
}
module.exports={createUpdateAcceleration,normalizeSettings,normalizeProxy,proxyFor,accelerateUrl};
