# EasyTier 高级设置

入口：系统设置 → EasyTier → 高级设置。设置仅保存在本机的 Electron 用户数据目录 `easytier-settings.json`，下次连接服务器时生效，不会修改服务器或其他成员的配置。

默认开启多线程，其他选项默认关闭。恢复默认后需要点击保存。读取失败时禁止保存，避免覆盖原配置。

客户端自动直连默认使用 `--default-protocol udp`，优先尝试对方的 UDP 监听地址，失败后仍可尝试 TCP 等其他协议；`--p2p-only false` 保留中转，`--lazy-p2p false` 允许主动发现直连。服务器配置的初始节点 URL 不改写为 UDP，发现节点可以继续使用 TCP。已保存的“禁用 P2P”“禁用 UDP 打洞”等高级选项仍按用户配置执行。修改需要重新连接服务器，不会强制中断正在进行的语音。

这是直连尝试的优先顺序，不是强制所有数据使用 UDP：网络限制、对端配置及 EasyTier 的连接选择仍影响最终协议。[内置版本直连尝试逻辑](https://github.com/EasyTier/EasyTier/blob/v2.6.4/easytier/src/connector/direct.rs)。本地六节点测试 `node app/tests/integration/smoke-udp-priority.cjs` 验证双协议成员优先建立 UDP 直连，以及仅 TCP 成员可以回退直连；不创建虚拟网卡，不访问公共节点。

界面提供 19 个选项及问号说明，参数以软件内置的 EasyTier **2.6.4-8428a89d** 为准。启动时仅使用已知布尔参数，不接收任意命令行参数。

## 当前限制

- 无 TUN 模式显示为不可用：语音、屏幕共享和 lolPing 同步依赖虚拟 IP，启动流程也需要等待虚拟网卡就绪。仅关闭 TUN 无法让这些功能正常运行。
- KCP 和 QUIC 代理处理虚拟网中的 TCP 连接，不直接优化 UDP 语音、视频。内置版本同时开启时优先使用 QUIC。
- 系统转发需要预先配置操作系统转发、路由和防火墙；此开关不会自动配置这些规则。
- 禁用加密需要通信双方保持一致；魔法 DNS 会调整 Windows DNS 配置。

## 说明来源

说明参考官方文档，并与内置 `easytier-core.exe --help` 核对：

- [命令行及配置参数](https://easytier.cn/en/guide/network/configurations.html)
- [KCP / QUIC 代理](https://www.easytier.cn/guide/network/kcp-proxy.html)
- [子网代理和系统转发](https://www.easytier.cn/guide/network/point-to-networking.html)
- [魔法 DNS](https://www.easytier.cn/guide/network/magic-dns.html)
- [无管理员权限 / 无 TUN 模式](https://www.easytier.cn/guide/network/no-root.html)

核对日期：2026-10-21。

## 尝试启用 IPv6

系统设置 → EasyTier → IPv6 网络提供一次性“尝试启用 IPv6”按钮。只有点击后才操作系统网卡；不会随软件启动自动修改网络设置。

使用 Windows `Get-NetAdapter -Physical` 选择已连接的物理网卡，优先选择具有默认路由的网卡，通过 `Enable-NetAdapterBinding` 开启 `ms_tcpip6`。不修改虚拟网卡、DNS、路由器、注册表或防火墙。实际启用需要管理员权限，网卡绑定变更可能短暂重连网络。

结果区分：协议启用失败、未获得公网地址、已获得地址但连通性未确认、IPv6 连通检测通过，以及 Windows 策略禁用 IPv6。若 EasyTier 的“禁用 IPv6”仍开启，提示用户关闭后重新连接，不自动覆盖其设置。

连通探测使用当前物理网卡的公网 IPv6 地址，分别向阿里云 `2400:3200::1` 和 Cloudflare `2606:4700:4700::1111` 的 TCP 53 端口尝试握手；不发送应用数据，不改变 DNS 配置。任一节点可达才显示通过，探测失败不直接认定运营商不支持 IPv6。IPv6 可增加直连机会，不能保证 P2P 成功。

实现依据：[Microsoft 网卡绑定接口](https://learn.microsoft.com/en-us/powershell/module/netadapter/enable-netadapterbinding)、[Windows IPv6 策略说明](https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/configure-ipv6-in-windows)、[阿里云公共 DNS 地址](https://www.alibabacloud.com/help/zh/dns/free-service-disclaimer)、[Cloudflare IPv6 地址](https://developers.cloudflare.com/1.1.1.1/ip-addresses/)。

## 成员网络信息

服务器 IP 面板增加“路由”和“协议”两列，每轮 Ping 刷新时同时读取 EasyTier 状态。

- 本机显示“本机”；直接连接显示 `p2p`；中转显示 `relay(跳数)`。
- 协议使用 EasyTier 实际报告的隧道类型，如 `tcp`、`udp`、`tcp6`；`6` 表示 IPv6 传输，与成员的 IPv4 虚拟地址不矛盾。无数据时显示“—”。
- 状态仅查询本软件创建的本机回环 RPC 端口和唯一实例名，不查询其他软件的默认 EasyTier 实例。
- 管理工具随客户端打包，不需要用户安装或运行时下载。新增 `app/res/easytier-cli.exe` 使用现有 Git LFS 规则管理，发布前必须纳入版本控制。

管理工具来源：[官方 v2.6.4 Windows x86_64 压缩包](https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-windows-x86_64-v2.6.4.zip)，版本 `2.6.4-8428a89d`。`easytier-cli.exe` 的 SHA-256：`D8783E851E944B44A9B71B39FD02F227EC0A2A82B3165C55EAD5DD32DCDE53A1`。

## 验证

在 `app` 目录运行：

```powershell
npm test
node scripts/run-electron.cjs smoke-easytier-settings.cjs
node scripts/run-electron.cjs smoke-channel-ui.cjs
node tests/integration/smoke-member-routes.cjs
```

单元测试会用内置程序的 `--config-file - --check-config` 检查全部参数；此检查不启动网络，也不创建虚拟网卡。界面测试验证本地保存、失败处理、恢复默认、提示位置和小窗口滚动。

成员网络原生测试在回环地址上创建五个无 TUN 节点，验证本机、TCP 直连、TCP6 直连和两跳中转；不会创建虚拟网卡或连接公共节点。
