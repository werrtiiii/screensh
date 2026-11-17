// Checked against bundled EasyTier 2.6.4 --help and the official docs (2026-10-21).
// This orders automatic peer direct-connect attempts. Bootstrap URLs retain
// their configured protocol, and relay/TCP remain available as fallbacks.
export const EASYTIER_CONNECTION_ARGS=Object.freeze(['--default-protocol','udp','--p2p-only','false','--lazy-p2p','false']);
export const EASYTIER_OPTIONS = [
  ['latencyFirst','latency-first','开启延迟优先模式','优先低延迟路径，可能经过更多节点。'],
  ['useSmoltcp','use-smoltcp','使用用户态协议栈','为子网和 KCP 的 TCP 代理使用用户态协议栈，可缓解部分防火墙问题；不直接降低语音延迟。'],
  ['disableIpv6','disable-ipv6','禁用 IPv6','仅禁用 EasyTier 的 IPv6，不修改 Windows 设置。虚拟地址仍使用 IPv4。'],
  ['enableKcpProxy','enable-kcp-proxy','启用 KCP 代理','用 KCP 代理 TCP，可改善丢包传输，但更耗流量；不影响 UDP 语音和视频。'],
  ['disableKcpInput','disable-kcp-input','禁用 KCP 输入','拒绝其他节点通过 KCP 代理访问本机 TCP，不关闭其他 KCP 中转。'],
  ['enableQuicProxy','enable-quic-proxy','启用 QUIC 代理','用 QUIC 代理 TCP，可改善丢包传输。同时开启 KCP 时优先 QUIC。'],
  ['disableQuicInput','disable-quic-input','禁用 QUIC 输入','拒绝其他节点通过 QUIC 代理访问本机 TCP，对方改用其他可用方式。'],
  ['disableP2p','disable-p2p','禁用 P2P','关闭自动直连，通常改走中转；显式要求 P2P 的节点仍可直连。'],
  ['bindDevice','bind-device','仅使用物理网卡','绑定物理网卡，减少虚拟网卡或代理引起的路由冲突；不指定某张网卡。'],
  ['noTun','no-tun','无 TUN 模式','不创建虚拟网卡，改用本地端口转发。下次连接生效，开销较高，建议优先使用默认 TUN。'],
  ['enableExitNode','enable-exit-node','启用出口节点','允许其他节点借本机访问互联网，可能增加带宽占用；本机出口不变。'],
  ['relayAllPeerRpc','relay-all-peer-rpc','转发 RPC 包','转发白名单外节点的控制包，帮助发现和直连；不开放本机管理端口。'],
  ['multiThread','multi-thread','启用多线程','多线程处理网络任务，可提高并发，也可能增加 CPU 和内存占用。'],
  ['proxyForwardBySystem','proxy-forward-by-system','系统转发','由系统转发子网流量并关闭内置 NAT，需自行配置路由、转发和防火墙。'],
  ['disableEncryption','disable-encryption','禁用加密','关闭隧道加密，通信双方须一致。建议保持默认加密。'],
  ['disableUdpHolePunching','disable-udp-hole-punching','禁用 UDP 打洞','停止 UDP 打洞探测，可能增加中转依赖；不禁止其他 UDP 通信。'],
  ['disableSymHolePunching','disable-sym-hole-punching','禁用对称 NAT 打洞','停止对称 NAT 打洞，减少探测流量，但可能降低复杂网络的直连成功率。'],
  ['acceptDns','accept-dns','启用魔法 DNS','通过“主机名.et.net”访问节点。会调整 Windows DNS，可能影响原有解析。'],
  ['privateMode','private-mode','启用私有模式','拒绝无法验证网络密钥或受信凭据的外部节点接入、转发；不能替代服务器密码。'],
].map(([key,flag,label,help])=>({key,flag:'--'+flag,label,help,defaultValue:key==='multiThread',unavailable:false}));

export function normalizeEasyTierSettings(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('EasyTier 高级设置无效');
  const result={};
  for(const option of EASYTIER_OPTIONS){
    if(Object.hasOwn(value,option.key)&&typeof value[option.key]!=='boolean')throw Error('EasyTier 开关设置必须为布尔值');
    result[option.key]=Object.hasOwn(value,option.key)?value[option.key]:option.defaultValue;
    if(option.unavailable&&result[option.key])throw Error('当前软件需要 TUN 虚拟网卡，暂不支持无 TUN 模式');
  }
  return result;
}
export function easyTierAdvancedArgs(value){const config=normalizeEasyTierSettings(value);if(config.noTun){config.bindDevice=false;config.proxyForwardBySystem=false;}return EASYTIER_OPTIONS.flatMap(option=>[option.flag,String(config[option.key])]);}
