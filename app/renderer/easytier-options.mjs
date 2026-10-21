// Checked against bundled EasyTier 2.6.4 --help and the official docs (2026-10-21).
// This orders automatic peer direct-connect attempts. Bootstrap URLs retain
// their configured protocol, and relay/TCP remain available as fallbacks.
export const EASYTIER_CONNECTION_ARGS=Object.freeze(['--default-protocol','udp','--p2p-only','false','--lazy-p2p','false']);
export const EASYTIER_OPTIONS = [
  ['latencyFirst','latency-first','开启延迟优先模式','优先选择延迟较低的转发路径，而不是跳数最少的路径；实际效果取决于节点和网络情况。'],
  ['useSmoltcp','use-smoltcp','使用用户态协议栈','为子网代理和 KCP 代理的 TCP 流量使用 smoltcp 用户态协议栈，可绕过部分系统协议栈或防火墙问题；并非语音降延迟开关。'],
  ['disableIpv6','disable-ipv6','禁用 IPv6','让 EasyTier 不使用 IPv6 连接，不会关闭 Windows 系统的 IPv6；软件仍使用 IPv4 虚拟地址。'],
  ['enableKcpProxy','enable-kcp-proxy','启用 KCP 代理','将虚拟网中的 TCP 连接代理为 KCP，可改善丢包时的 TCP 传输，但可能增加流量；不直接作用于 UDP 语音或视频。'],
  ['disableKcpInput','disable-kcp-input','禁用 KCP 输入','不接受其他节点通过 KCP 代理访问本机的 TCP 连接，对方会改用其他可用方式；不是关闭所有 KCP 中转。'],
  ['enableQuicProxy','enable-quic-proxy','启用 QUIC 代理','通过 QUIC 代理虚拟网中的 TCP 连接，改善部分丢包网络的吞吐量；内置 2.6.4 同时开启两种代理时优先 QUIC。'],
  ['disableQuicInput','disable-quic-input','禁用 QUIC 输入','不接受其他节点通过 QUIC 代理访问本机的 TCP 连接，对方会改用其他可用方式。'],
  ['disableP2p','disable-p2p','禁用 P2P','禁用普通的自动 P2P 直连，通常改走已连接节点中转；明确标记为需要 P2P 的节点仍可能建立直连。'],
  ['bindDevice','bind-device','仅使用物理网卡','将 EasyTier 连接器的套接字绑定到物理设备，减少虚拟网卡或代理网段带来的路由冲突；不是指定某一张网卡。'],
  ['noTun','no-tun','无 TUN 模式','不创建虚拟网卡，主要用于子网代理。当前软件的语音、屏幕共享和 lolPing 同步依赖虚拟网卡，暂不可启用。'],
  ['enableExitNode','enable-exit-node','启用出口节点','允许其他节点选择本机作为互联网流量出口，可能增加本机带宽占用；开启此项不会让本机改用别人的出口。'],
  ['relayAllPeerRpc','relay-all-peer-rpc','转发 RPC 包','允许转发网络白名单之外节点的控制 RPC 数据包，帮助发现节点和建立 P2P；不是开放本机的管理 RPC 端口。'],
  ['multiThread','multi-thread','启用多线程','使用多线程运行时处理网络任务，提高多核并发能力，CPU 和内存开销可能增加；关闭后使用单线程。'],
  ['proxyForwardBySystem','proxy-forward-by-system','系统转发','把子网代理的数据包交给系统内核转发，并关闭内置 NAT；需要系统已经配置正确的转发、路由和防火墙规则。'],
  ['disableEncryption','disable-encryption','禁用加密','关闭 EasyTier 节点间的隧道加密，需要通信双方设置一致，否则可能无法通信；默认保持加密。'],
  ['disableUdpHolePunching','disable-udp-hole-punching','禁用 UDP 打洞','关闭 UDP NAT 打洞探测，可能降低直连成功率并增加对中转的依赖；不等于禁止所有 UDP 通信。'],
  ['disableSymHolePunching','disable-sym-hole-punching','禁用对称 NAT 打洞','关闭基于生日碰撞的对称 NAT UDP 打洞，减少相关探测流量，但可能降低复杂 NAT 下的直连成功率。'],
  ['acceptDns','accept-dns','启用魔法 DNS','通过“主机名.et.net”访问其他节点，无需记住虚拟 IP；在 Windows 上会调整 DNS 配置，可能影响现有 DNS 解析。'],
  ['privateMode','private-mode','启用私有模式','限制外部网络借本机接入或转发，拒绝无法验证相同网络密钥或受信凭据的外部节点；不能代替服务器加入密码。'],
].map(([key,flag,label,help])=>({key,flag:'--'+flag,label,help,defaultValue:key==='multiThread',unavailable:key==='noTun'}));

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
export function easyTierAdvancedArgs(value){const config=normalizeEasyTierSettings(value);return EASYTIER_OPTIONS.flatMap(option=>[option.flag,String(config[option.key])]);}
