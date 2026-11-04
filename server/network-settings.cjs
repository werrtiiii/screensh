const {isIPv4}=require('node:net');
function privateIp(ip){if(typeof ip!=='string'||!isIPv4(ip))return false;const [a,b]=ip.split('.').map(Number);return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;}
function directRelayUrl(value){
  if(typeof value!=='string'||value.length>2048)throw Error('请填写有效的 MediaMTX HTTP/HTTPS 地址');
  let url;try{url=new URL(value.trim());}catch{throw Error('请填写完整的 MediaMTX 地址，例如 https://video.example.com:8889');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('MediaMTX 地址仅填写 HTTP/HTTPS 协议、IP 或域名及端口，不包含路径或密码');
  return url.origin;
}
function normalizeNetwork(value){
  if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>128||/[\x00-\x1f\x7f]/.test(value.name)||typeof value.secret!=='string'||value.secret.length>128||/[\x00-\x1f\x7f]/.test(value.secret))throw Error('请填写有效的组网名称和密码（最多128个字符）');
  if(value.relayHost!==undefined&&typeof value.relayHost!=='string')throw Error('MediaMTX 节点地址格式无效');
  const host=value.relayHost?.trim()||'',port=Number(value.relayPort??8889);
  if(host&&!privateIp(host))throw Error('MediaMTX 节点必须填写私有虚拟 IPv4 地址');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('MediaMTX HTTP 端口必须为1024至65535');
  const relayTransport=value.relayTransport??'easytier';
  if(!['easytier','direct'].includes(relayTransport))throw Error('无效的视频转发方式');
  const relayUrl=value.relayUrl?directRelayUrl(value.relayUrl):'';
  if(relayTransport==='direct'&&!relayUrl)throw Error('请填写直连 MediaMTX 地址');
  return {name:value.name.trim(),secret:value.secret,dhcp:true,relayHost:host,relayPort:port,relayTransport,relayUrl};
}
function externalRelayStatus(config,enabled){
  const direct=config.relayTransport==='direct';let url;try{if(direct&&config.relayUrl)url=new URL(directRelayUrl(config.relayUrl));}catch{}
  const configured=direct?!!url:privateIp(config.relayHost);
  return {version:2,mode:'external',transport:direct?'direct':'easytier',url:direct?url?.origin||'':undefined,configured,enabled,ready:enabled&&configured,host:direct?url?.hostname||null:configured?config.relayHost:null,port:direct?url?Number(url.port||(url.protocol==='https:'?443:80)):null:config.relayPort,message:!enabled?'已关闭软件转发，外部服务保持运行':configured?direct?'直接连接 MediaMTX，推拉流不经过 EasyTier':'已配置外部节点；连接时验证可达性':direct?'请配置直连 MediaMTX 地址':'请配置运行 MediaMTX 的节点虚拟 IP'};
}
function relayEndpoint(status){return {host:status.host,port:status.port,...(status.transport==='direct'?{transport:'direct',url:status.url}:{})};}
module.exports={normalizeNetwork,externalRelayStatus,privateIp,directRelayUrl,relayEndpoint};
