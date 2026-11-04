# EasyTier 无 TUN UDP 缓冲诊断补丁

`easytier-2.6.4-udp-buffers.patch` 基于上游 `v2.6.4`，提交
`8428a89d2dabc94c97d370ec607c6ca142473626`。

上游端口转发使用的 smoltcp UDP 收发缓冲各为 8192 字节，元数据队列各为
32 项。本补丁将其分别扩大到 1 MiB、1024 项，并将端口转发入口的操作系统
UDP 收发缓冲各设置为 2 MiB。TCP 缓冲及协议保持不变。

这是针对无 TUN 视频突发承载限制的补丁，不代表已经解决公网、NAS 或所有
无 TUN 连接的丢包。增大缓冲也不能增加可用
带宽，每个活跃用户态 UDP socket 会增加约 2 MiB 的缓冲分配。

## 重建

从上述上游提交建立独立工作目录，执行 `git apply` 应用补丁，然后运行：

```text
cargo build --release --locked --package easytier --bin easytier-core
```

本地诊断使用 Rust 1.99.1、Windows GNU 目标、MinGW 8.1、protoc 26.0 和
libclang 18.1.1，不启用 mimalloc。GNU 构建与上游 Windows MSVC 发布构建不同，
需先确认可独立启动及 RPC 兼容，再进行真实媒体对照。

## 对照验证

`app/tests/integration/probe-easytier-udp.cjs` 创建两个本机隔离的无 TUN 实例，
测量 UDP 往返丢包。`app/tests/integration/smoke-relay-media.cjs` 使用真实
MediaMTX、OBS、WebRTC 和 EasyTier 转发合成动态视频。两者均可通过
`SCREENSH_TEST_EASYTIER_EXE` 指向待测核心，不需要替换客户端默认核心。

必须同时检查服务器发布端 RTP 丢包/FU-A 日志及观看端解码情况。节流器
`dropped: 0` 或观看端单次出画面，均不足以证明整条链路正常。

2026-11-04 本机诊断结果（并非 NAS 公网测试）：

| 场景 | 原版核心 | 补丁核心 |
| --- | --- | --- |
| 每批 8 包、间隔 2 ms，共 1200 包往返 | 上下行均零丢包 | 上下行均零丢包 |
| 一次突发 1200 个 1200 字节 UDP 包 | 上行到达 63 包 | 上行到达 1200 包 |
| 动态 1080p NVENC 自观看 12 秒 | 本次通过；此前曾复现发布端丢包 | 通过，观看端丢包 0，服务器无 RTP/FU-A 错误 |

突发诊断通过 `SCREENSH_TEST_UDP_BURST=1200` 启用。这种压力高于正常平均
视频流量，用来比较承载能力，不能用它代替实际网络验证。原版与补丁也使用
不同 Windows 编译工具链，因此不将全部运行差异归因于单一缓冲参数。

补丁核心 SHA256：
`0f5a26126148416b49756d478384db5aca2f96a99e4a963c4fe8a96bba657a50`。

补丁核心以 `app/res/easytier-core-no-tun.exe` 单独提供，只有无 TUN 模式使用。
TUN 模式仍使用原版 `app/res/easytier-core.exe`。本地 GNU 补丁构建在用户
环境中出现了 Wintun 加载期间的签名错误，而现有 Wintun DLL 的 Authenticode
校验有效，因此未将该构建用于 TUN，也没有关闭或绕过任何签名检查。

原版核心 SHA256（回退参考）：
`657400c756aa4e2868b9505f669527733ba872dff3b8877cee24d7772616c76b`。
