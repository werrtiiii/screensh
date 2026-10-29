# EasyTier 高级设置

入口：系统设置 → EasyTier → 高级设置。设置仅保存在本机的 Electron 用户数据目录 `easytier-settings.json`，下次连接服务器时生效，不会修改服务器或其他成员的配置。

默认开启多线程，其他选项默认关闭。恢复默认后需要点击保存。读取失败时禁止保存，避免覆盖原配置。

客户端自动直连默认使用 `--default-protocol udp`，优先尝试对方的 UDP 监听地址，失败后仍可尝试 TCP 等其他协议；`--p2p-only false` 保留中转，`--lazy-p2p false` 允许主动发现直连。服务器配置的初始节点 URL 不改写为 UDP，发现节点可以继续使用 TCP。已保存的“禁用 P2P”“禁用 UDP 打洞”等高级选项仍按用户配置执行。修改需要重新连接服务器，不会强制中断正在进行的语音。

这是直连尝试的优先顺序，不是强制所有数据使用 UDP：网络限制、对端配置及 EasyTier 的连接选择仍影响最终协议。[内置版本直连尝试逻辑](https://github.com/EasyTier/EasyTier/blob/v2.6.4/easytier/src/connector/direct.rs)。本地六节点测试 `node app/tests/integration/smoke-udp-priority.cjs` 验证双协议成员优先建立 UDP 直连，以及仅 TCP 成员可以回退直连；不创建虚拟网卡，不访问公共节点。

界面提供 19 个选项及问号说明，参数以软件内置的 EasyTier **2.6.4-8428a89d** 为准。启动时仅使用已知布尔参数，不接收任意命令行参数。

## 当前限制

- 无 TUN 模式默认关闭，可以在高级设置启用，保存后重新连接服务器生效。此模式不创建虚拟网卡，通过 EasyTier 动态 TCP/UDP 端口转发接通语音、屏幕共享和频道内 lolPing；不提供供其他软件直接访问的系统虚拟网卡。
- 无 TUN 模式保留 UDP 媒体传输，增加本机回环转发开销；具体延迟取决于设备和网络。软件安装包仍要求管理员启动，此选项不会更改程序权限清单。IP 面板两种模式均优先使用端到端 UDP 延迟探测，支持混合模式与中转。
- 无 TUN 模式启动时不应用“仅使用物理网卡”和“系统转发”，避免绕过用户态转发路径；这两个选项的保存值不变。为兼容内置 2.6.4 的转发栈生命周期，连接服务器期间保留一条不承载业务的回环 TCP 规则，退出服务器时清理。参考[内置版本实现](https://github.com/EasyTier/EasyTier/blob/v2.6.4/easytier/src/gateway/socks5.rs)。
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

服务器「配置节点」弹窗下方可测试当前输入的节点，按顺序显示 TCP/UDP 的 EasyTier 握手结果与失败原因。测试使用独立实例和本机随机管理端口，不创建 TUN、不修改正在使用的节点配置；每个节点最多等待 15 秒。显示耗时为连接握手时间，不是网络 RTT，也不保证节点的持续吞吐量。输入改变或关闭弹窗后，旧结果失效且不再测试剩余节点。

服务器 IP 面板增加“路由”和“协议”两列，每轮 Ping 刷新时同时读取 EasyTier 状态。

- 本机显示“本机”；直接连接显示 `p2p`；中转显示 `relay(跳数)`。
- 延迟优先使用软件 UDP 往返探测；未响应时，TUN 本机再尝试 ICMP，两种模式最后均可使用 EasyTier 直连隧道 RTT 作为参考。悬停延迟可查看来源；中转不使用第一跳的 RTT 冒充端到端延迟。所有方式均无结果时显示“未响应”，不代表语音或共享一定中断。UDP 探测需要对端支持并允许探测端口（UDP 31113）。
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
node scripts/run-electron.cjs smoke-no-tun.cjs
```

单元测试会用内置程序的 `--config-file - --check-config` 检查全部参数；此检查不启动网络，也不创建虚拟网卡。界面测试验证本地保存、失败处理、恢复默认、提示位置和小窗口滚动。

成员网络原生测试在回环地址上创建五个无 TUN 节点，验证本机、TCP 直连、TCP6 直连和两跳中转；不会创建虚拟网卡或连接公共节点。

无 TUN 媒体测试创建三个独立 EasyTier 实例，验证三组成员的双向音频解码、关闭语音后加密 lolPing 收发、OBS 发布共享、远端与本机 WHEP 视频解码，以及结束后管理 RPC 中转发规则为空。此测试只连接本机回环节点，不代表所有公网 NAT 和防火墙环境均已验证。

混合模式专项测试：在 Windows 管理员终端中进入 `app` 目录运行 `npm run test:mixed-tun`。测试创建一个唯一命名的临时 TUN 网卡，使用空闲测试地址段 `10.144.242.0/30`，另一端关闭 TUN；交换语音发起方、分别核对两端音频包和解码数据，并验证双向共享、各自预览、加密 lolPing 双向收发和转发规则清理。结束时关闭测试创建的 EasyTier 进程。不会使用现有 EasyTier 实例、公共节点或修改默认路由。

混用时无 TUN 一方的 UDP 转发会改变源端口。TUN 接收端须使用本次更新后的客户端，按成员虚拟地址及加密密钥验证该流，仍执行消息身份、频道隔离和防重放检查。旧版本 TUN 客户端的 lolPing 接收端不具备此兼容处理。

## 能看到成员但媒体一直连接中

`relay(2)` 表示通过一个中转节点到达对方，不等于组网失败。若语音一直连接中，先核对双方“禁用加密”选项是否一致。建议双方都取消勾选此项，保存后退出服务器再重新连接；仅切换频道不会重启 EasyTier 或应用新的高级设置。处在对称 NAT 网络时，取消“禁用对称 NAT 打洞”可以恢复对应的直连尝试，但不能保证直连。

2026-10-22 补测：以不同网络身份的节点作为中转，确认 `relay(2)` 下双向音频解码、共享和加密 lolPing 可用；双方都关闭 EasyTier 加密时也可用。仅一端关闭加密时，可以发现中转路由，但双向音频收包、解码数据均为零。测试通过环境变量 `SCREENSH_TEST_RELAY=1`、`SCREENSH_TEST_DISABLE_ENCRYPTION=1`（双方关闭）或 `SCREENSH_TEST_MISMATCH_ENCRYPTION=1`（不一致复现）配置，然后运行 `npm run test:no-tun`。默认仅使用本机测试中转；显式设置 `SCREENSH_TEST_RELAY_PEERS` 为节点 URL 的 JSON 数组，才会连接指定外部中转。

## 无 TUN 共享的突发流量与卡顿

`SCREENSH_TEST_STRESS=1` 将原生测试切为 1080p、30 帧、5000 kbps 的高纹理图像压测，每个远端及本机观看会话连续采样约 20 秒，记录丢包、NACK、PLI、解码帧数和媒体字节；可以与混合模式、中转模式组合。它是关键帧突发压力测试，不能把静态图像的解码帧数直接当作运动画面的帧率。

修复分为三部分：本机媒体桥 UDP 接收缓冲提高到 2 MiB、发送缓冲提高到 512 KiB；MediaMTX 使用 2 MiB UDP 接收缓冲并将最大 UDP 负载限制为 1200 字节，减少虚拟网络分片；无 TUN 共享端加入独立原生 UDP 平滑发包进程，把视频突发包分散发送，STUN、DTLS 和 RTCP 控制包立即转发。继续使用 UDP，不通过降低配置码率或帧率来规避问题。

原生助手使用 Windows 高精度等待定时器，避免 JavaScript 定时器在负载下合并成较大突发；它只监听 `127.0.0.1:8189`，转发到 MediaMTX 的 `127.0.0.2:8189`。TUN 共享端继续使用原路径。每个连接的排队数据最多 2 MiB、最多 64 个回环流，异常持续过载时仍可能丢包。共享停止、失败或退出服务器时关闭助手并释放端口。构建命令会自动编译 `native/media-udp-pacer.cpp`，开发运行也会先执行 `build:media-pacer`。

内置 EasyTier 用户态 UDP 收发缓冲仍为 [8192 字节](https://github.com/EasyTier/EasyTier/blob/v2.6.4/easytier/src/gateway/tokio_smoltcp/socket_allocator.rs)，没有修改其二进制。通过扩大外层接收缓冲及平滑输入减少小队列溢出。动态纹理对照测试中，仅扩大缓冲、关闭平滑发包时，20 秒解码约 359 帧、NACK 862 次；组合修复后约 586 帧、丢包及 NACK 均为零。TUN/无 TUN 两个共享方向分别解码约 583、587 帧，丢包及 NACK 均为零。动态测试同时检查持续帧率、丢包、重传及累计冻结时间，不再以解码几帧作为性能验收。

开启 `SCREENSH_TEST_MOTION=1` 使用循环滚动纹理；`SCREENSH_TEST_EXTREME_NOISE=1` 改用全分辨率随机噪声，它超出普通屏幕画面的压缩复杂度，应单独解释编码损失，不能冒充实际业务视频。`SCREENSH_TEST_WATCH_MS=60000` 延长远端播放至一分钟，随后检查本机预览；`SCREENSH_TEST_PACER=0` 仅用于关闭平滑发包的对照测试。每轮测试使用专属 OBS 主机身份，结束后关闭测试媒体进程、转发与临时网卡。

资源监视器使用字节/秒，5000 kbps 的原始视频约为 625000 字节/秒。进程网络总量包含回环转发、协议封装、重传和其他流量，不等于该视频的外网有效码率，应分别查看远端地址和本机地址的流量。运行压力测试会额外产生独立节点的媒体流量。

## 屏幕共享与频道语音同时运行

频道码率通过 `maxBitrate` 设置，Opus 仍是可变码率。选择 96 kbps 不代表每个统计区间都必须收到 96 kbps；静音、输入内容和网络拥塞均可能改变实际码率。不能仅凭 60 kbps 判定故障，但接收缓冲达到 500～1200 ms 已经意味着明显的播放积压。[Opus 参数说明](https://www.rfc-editor.org/rfc/rfc7587.html)

无 TUN 的浏览器 UDP 桥原先每收到一个包都同步调用 `os.networkInterfaces()` 验证来源。在本机一次枚举约需 6 ms，高包率视频会阻塞同一主线程中的语音转发。现在在建立桥时保存本机地址白名单，逐包只查集合，仍拒绝其他机器的源地址。桥绑定接口不变，更换网络后需要重新连接媒体会话。

2026-10-22 本机对照：双向 96 kbps 连续合成音频，同时通过真实 EasyTier 无 TUN 节点观看 OBS 的 1080p/30FPS/5000 kbps 动态共享，共采样 30 秒。修复前出现约 50～65 kbps 接收和秒级缓冲；修复后启动阶段的缓冲会回落，后 20 秒两端缓冲约 37～47 ms，区间丢包及丢包补偿均为零，接收约 96～100 kbps。共享端 OBS 初始化时仍可能短暂停顿，此测试不声称消除了启动阶段的阻塞。

复测：设置 `SCREENSH_TEST_STRESS=1`、`SCREENSH_TEST_MOTION=1`、`SCREENSH_TEST_CONCURRENT_VOICE=1`、`SCREENSH_TEST_WATCH_MS=30000`，运行 `npm run test:no-tun`。测试在语音保持连接期间播放共享，启动十秒后检查每次语音采样的缓冲低于 150 ms、丢包和补偿占比低于 1%，同时执行原有视频帧率检查。默认仅使用本机回环节点，不能据此推断公网和双方 TUN 均已修复。

所有模式的语音发送申请较高的媒体与网络优先级，但 EasyTier 外层封装、路由器及运营商不一定保留或执行 DSCP，不能保证公网带宽分配。统计面板新增发送码率、发送排队、区间丢包、丢包补偿、目标和最小接收缓冲。双方 TUN 不经过浏览器 UDP 桥；如仍卡顿，需结合两端这些数据判断外部链路拥塞、发送不足或接收播放积压，不能归因为同一处代码。

### 96 kbps 降至约 60 kbps 的计时降频

后续 UDP6 长测发现另一种情况：没有观看者时，共享运行约 30 秒后，合成音频采样时钟每个实际秒仅推进约 0.64 秒；10 ms 音频包由约 100 包/秒降至约 64 包/秒。RTT、区间丢包率和发送队列仍正常，但接收端大量生成补偿采样。这一现象不能用 Opus 正常可变码率解释，也不能只用网络拥塞解释。

Windows 11 可在进程不可见或不可听时忽略高精度计时请求，参见 [timeBeginPeriod](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod) 和 [SetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation)。仅关闭 Chromium 后台计时节流，在本机对照中未解决该现象。现在语音采集启动后，对 Electron `app.getAppMetrics()` 返回的本应用进程设置进程级策略：保留高精度计时请求、关闭执行速度降频；仍由音频引擎决定具体计时精度。定期覆盖新建的本应用子进程，停止语音时恢复各进程原始策略。恢复时同时检查 PID 和进程创建时间，避免 PID 重用后误改其他进程。此处理不修改注册表、系统全局计时器或其他软件。

原生入口复用 `screensh-media-udp.exe --audio-policy`，TUN 模式也会使用。旧系统不支持保留计时精度策略时，仅尝试执行速度策略；API 不可用不应阻断语音连接。`realtime-policy.cjs` 还关闭本应用的 Chromium 后台优先级降低和窗口遮挡节流。

复测可以设置 `SCREENSH_TEST_TRANSPORT=udp6` 选择 IPv6 UDP 回环组网（协议 URL 仍是 `udp://[::1]:端口`），其余压力与同时语音参数同上，建议 `SCREENSH_TEST_WATCH_MS=60000`。`SCREENSH_TEST_NO_VIEWER=1` 只启动共享编码，不创建观看连接；`SCREENSH_TEST_AUDIO_TIMING=0` 仅用于关闭进程计时策略的对照。混合模式使用 `npm run test:mixed-tun`，需要管理员权限。测试记录音频源累计采样时长、AudioContext 时钟、实际时钟和发包速率，以区分音频生成不足和转发排队。

长测仍使用连续合成音频和本机独立 EasyTier 实例，不能替代两台公网机器、真实麦克风和显卡驱动的验证。统计面板补充双向音频包速率，便于在实际故障时判断是否也发生了约 100→64 包/秒的变化。

采用正式计时策略后，UDP6 混合模式中两个共享方向分别完成无人观看 60 秒及有人观看 60 秒。启动十秒后的采样中，无人观看缓冲最高约 68 ms，有人观看也低于 68 ms，区间丢包及补偿占比均为零，发包维持约 100 包/秒；测试结束恢复计时策略并清理转发规则和测试网卡。OBS 初始化/切换时仍可出现短暂停顿，不把启动阶段的数据当作持续稳定阶段。
