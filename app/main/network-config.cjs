function normalizeClientNetwork(serverId,value){
  if(value===undefined||value===null)return {name:'screensh-'+serverId,secret:process.env.SCREENSH_NETWORK_SECRET||'screensh-p2p',dhcp:false,relayHost:''};
  if(typeof value!=='object'||typeof value.name!=='string'||!value.name.trim()||value.name.length>128||/[\x00-\x1f\x7f]/.test(value.name)||typeof value.secret!=='string'||value.secret.length>128||/[\x00-\x1f\x7f]/.test(value.secret)||typeof value.dhcp!=='boolean')throw Error('服务器组网配置无效');
  const relayHost=value.relayHost||'';if(relayHost&&!require('./virtual-address.cjs').isPrivateVirtualIp(relayHost))throw Error('服务器转发节点地址无效');
  return {name:value.name.trim(),secret:value.secret,dhcp:value.dhcp,relayHost};
}
module.exports={normalizeClientNetwork};
