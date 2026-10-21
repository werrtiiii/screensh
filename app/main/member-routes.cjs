const {execFile}=require('node:child_process');
const {isIPv4,createServer}=require('node:net');

// A private loopback portal and instance selector keep another EasyTier app's
// default management port from supplying unrelated connection information.
function allocateRpcPortal(){return new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve('127.0.0.1:'+port));});});}
function parsePeerRows(output){
  const rows=JSON.parse(output);
  if(!Array.isArray(rows))throw Error('EasyTier 返回的路由数据无效');
  return rows.flatMap(row=>{
    if(!row||!isIPv4(row.ipv4))return [];
    const local=row.cost==='Local';
    const route=local?'本机':row.cost==='p2p'?'p2p':/^relay\(\d+\)$/.test(row.cost)?row.cost:'—';
    // Preserve IPv4/IPv6 tunnel labels reported by EasyTier (e.g. tcp6).
    const protocol=typeof row.tunnel_proto==='string'&&/^[a-z0-9,+ _-]{1,100}$/i.test(row.tunnel_proto)&&row.tunnel_proto!=='-'?row.tunnel_proto:'—';
    const latency=Number(row.lat_ms);
    return [{ip:row.ipv4,route,protocol:local?'—':protocol,...(route==='p2p'&&latency>0&&Number.isFinite(latency)?{rttMs:latency}:{})}];
  });
}
function createMemberRoutes({exe,getContext,execute=execFile,now=Date.now}){
  let cached=null,inflight=null;
  return {read(){
    const context=getContext();
    if(!context)return Promise.resolve({available:false,rows:[]});
    if(cached?.context===context&&now()-cached.time<2000)return Promise.resolve(cached.value);
    if(inflight?.context===context)return inflight.promise;
    const promise=new Promise(resolve=>execute(exe,['-p',context.portal,'-n',context.instance,'-o','json','peer','list'],{windowsHide:true,encoding:'utf8',timeout:2500,maxBuffer:2*1024*1024},(error,stdout)=>{
      let value={available:false,rows:[]};
      if(!error&&getContext()===context){try{value={available:true,rows:parsePeerRows(stdout)};}catch{}}
      if(getContext()===context)cached={context,time:now(),value};
      resolve(value);
    }));
    inflight={context,promise};void promise.finally(()=>{if(inflight?.promise===promise)inflight=null;});return promise;
  }};
}
module.exports={allocateRpcPortal,parsePeerRows,createMemberRoutes};
