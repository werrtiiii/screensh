const path=require('node:path');
const {readFileSync}=require('node:fs');
const {execFile}=require('node:child_process');
const {connect,isIPv6}=require('node:net');

// TCP handshakes only; no DNS settings change and no application data is sent.
const targets=['2400:3200::1','2606:4700:4700::1111'];
function probeAddress(localAddress,host){return new Promise(resolve=>{let done=false;const socket=connect({host,port:53,family:6,localAddress});const finish=ok=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(ok);};const timer=setTimeout(()=>finish(false),3500);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});}
function createIpv6Network({execute=execFile,probe=probeAddress,platform=process.platform,getEasyTierDisabled=async()=>false}={}){
  let running=null;
  async function perform(enable){
    if(platform!=='win32')throw Error('此功能仅支持 Windows');
    // PowerShell cannot open files inside app.asar. Electron reads the bundled
    // fixed script and passes it as UTF-16LE, without interpolating user input.
    const script=readFileSync(path.join(__dirname,'ipv6-network.ps1'),'utf8');
    const encoded=Buffer.from('& {\n'+script+'\n}'+(enable?' -EnableIPv6':''),'utf16le').toString('base64');
    const snapshot=await new Promise((resolve,reject)=>execute(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded],{windowsHide:true,encoding:'utf8',timeout:45000,maxBuffer:512*1024},(error,stdout)=>{
      if(error)return reject(Error(error.killed?'IPv6 检测超时，请重试':'无法检测或启用 IPv6，请确认以管理员身份运行软件'));
      try{const data=JSON.parse(stdout.replace(/^\uFEFF/,''));if(!Array.isArray(data.adapters)||!Array.isArray(data.addresses)||!Array.isArray(data.failures))throw Error();resolve(data);}catch{reject(Error('无法读取 Windows IPv6 检测结果'));}
    }));
    const warnings=[];try{if(await getEasyTierDisabled())warnings.push('EasyTier 高级设置中仍禁用了 IPv6，请关闭该选项并重新连接服务器。');}catch{warnings.push('无法读取 EasyTier 配置，请检查高级设置中的“禁用 IPv6”。');}
    const base={adapters:snapshot.adapters,warnings};
    if(snapshot.policyBlocked)return {...base,code:'policy-blocked',message:'Windows 系统策略禁用了 IPv6，需要先恢复系统 IPv6 设置，再重启电脑后重试。'};
    if(!snapshot.adapters.length)return {...base,code:'no-adapter',message:'未找到已连接的物理网卡，请先连接 Wi-Fi 或网线后重试。'};
    const enabled=snapshot.adapters.filter(adapter=>adapter.enabled),failed=snapshot.adapters.filter(adapter=>!adapter.enabled);
    if(failed.length)warnings.push('未能启用：'+failed.map(adapter=>adapter.name).join('、')+'。请以管理员身份运行后重试。');
    if(!enabled.length)return {...base,code:'enable-failed',message:'未能启用当前网卡的 IPv6 协议。'};
    const addresses=snapshot.addresses.filter(address=>typeof address==='string'&&isIPv6(address)&&/^[23]/.test(address)).slice(0,2);
    const prefix=snapshot.adapters.some(adapter=>adapter.changed)?'已启用网卡 IPv6 协议':'网卡 IPv6 协议已开启';
    if(!addresses.length)return {...base,code:'no-address',message:prefix+'，但尚未获得公网 IPv6 地址。请检查路由器和运营商是否提供 IPv6，稍后重试。'};
    const results=await Promise.all(addresses.flatMap(address=>targets.map(target=>probe(address,target).catch(()=>false))));
    if(results.some(Boolean))return {...base,code:'reachable',message:prefix+'，公网 IPv6 连通检测通过，可增加 P2P 直连机会。'};
    return {...base,code:'unconfirmed',message:prefix+'，已获得公网 IPv6 地址，但连通检测未通过。网络或探测节点可能受限，可稍后重试。'};
  }
  return {run(){return running||=(perform(true).finally(()=>{running=null;}));},inspect:()=>perform(false)};
}
module.exports={createIpv6Network};
