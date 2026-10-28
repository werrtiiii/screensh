# OpenList 自托管 Runner

## 当前部署

2026-10-28 已在飞牛 NAS（Debian 12 x64）部署并通过真实同步验证：

- Runner 名称 `screensh-fnos`，标签 `screensh-openlist`，普通用户目录 `/home/wsy/screensh-runner`。
- 原生 systemd 服务 `actions.runner.werrtiiii-screensh.screensh-fnos.service`，以 `wsy` 身份运行，已启用开机启动，不依赖 Docker。
- 已设置 `OPENLIST_RUNNER=["self-hosted","linux","screensh-openlist"]` 和 `OPENLIST_PUBLISH_URL=http://127.0.0.1:5244`。服务器代理为 `http://127.0.0.1:7890`，回环地址绕过代理。
- [1.5.3 验证任务](https://github.com/werrtiiii/screensh/actions/runs/40639133424)全部成功：正式更新文件下载 54 秒，OpenList 上传和校验 38 秒。随后匿名验证了新版安装包大小、签名分段下载及更新清单。耗时仅代表本次测试。

NAS 需要保持开机，Runner、代理及 OpenList 服务需要运行；没有匹配的在线 Runner 时同步任务会排队。GitHub 打包发布仍使用托管 Windows 机器。

Windows 安装包继续在 GitHub 托管的 Windows 机器上构建。发布完成后，独立的同步任务下载 GitHub 正式发行文件，验证安装包 SHA-512，再上传到 OpenList。同步失败不撤销 GitHub Release。

## 服务器要求

- Linux 服务器可主动访问 GitHub 的 HTTPS 服务；不要求公网入站地址，也不需要为 Runner 开放端口。
- 使用独立普通用户运行 Runner，不给它 NAS 管理员权限或 Docker socket。此 Runner 仅用于可信的发布同步，不能用于执行外部 PR。
- 安装 Git、Bash、GitHub CLI（`gh`）及 GitHub Runner 所需系统依赖。工作流通过 `actions/setup-node` 安装 Node.js 24；它的目录需要可写。
- 使用 GitHub 仓库 Settings → Actions → Runners → New self-hosted runner 提供的对应架构安装包、校验值和短期注册命令。不要把注册 token 写入仓库或聊天。
- 添加自定义标签 `screensh-openlist`，随后将 Runner 安装为后台服务，并确认 GitHub 页面状态为 Idle。

飞牛 NAS 部署前先确认实际 CPU 架构、SSH 连接、代理端口和 OpenList 的网络模式。不要直接修改 NAS 系统软件源；必要时使用隔离环境部署。

## 代理和本机上传

Runner 需要常驻，持续接收任务；同步脚本仅在任务期间运行。代理环境必须在启动 Runner 服务前配置，修改后重启服务。例如在 Runner 目录 `.env` 中设置（示例端口必须替换为实际值）：

```dotenv
https_proxy=http://127.0.0.1:7890
http_proxy=http://127.0.0.1:7890
no_proxy=127.0.0.1,localhost,::1
```

GitHub CLI、依赖下载和 Node 的外部请求使用服务器代理。本机上传必须绕过代理。同步步骤启用 `NODE_USE_ENV_PROXY=1`。如果 Runner 在容器中，`127.0.0.1` 默认指容器自身；须使用合适的网络模式，部署时验证实际可达性。

## 上线变量

确认专用 Runner 已经在线且具备 GitHub 下载及 OpenList 本机访问能力后，再设置仓库 Actions Variables：

| 名称 | 值 |
| --- | --- |
| `OPENLIST_RUNNER` | `["self-hosted","linux","screensh-openlist"]` |
| `OPENLIST_PUBLISH_URL` | 实际 OpenList 本机地址，例如 `http://127.0.0.1:5244` |

`OPENLIST_PUBLISH_URL` 仅在显式指定字面量回环地址 `127.0.0.1` 或 `[::1]` 时接受 HTTP；其他地址仍必须使用 HTTPS。客户端公开下载地址保持 HTTPS，不使用 NAS 本机地址。

继续使用 Secrets 中现有的 `OPENLIST_USERNAME` 和 `OPENLIST_PASSWORD`，账号仍只允许写入更新目录。

`OPENLIST_RUNNER` 未设置时仍使用 GitHub 托管 Windows 机器；设置后没有匹配标签的在线 Runner 时，任务会排队等待，不自动绕回托管机器。临时回退时移除该变量，并将 `OPENLIST_PUBLISH_URL` 恢复为公开 HTTPS 上传地址。

## 验收

在 main 分支手动运行 **Sync existing release to OpenList**，输入 `1.5.3`。检查执行机器是专用 Runner，脚本校验、安装包上传、目录刷新验证及最后更新清单全部成功，再使用匿名签名下载确认镜像文件正确。以后新版本发布完成后会自动调用同一个同步工作流。

部署不能只以 Runner 显示在线为完成标准，必须执行一次真实同步。已有版本标签仍包含旧工作流；仅重跑旧标签发布不一定使用新的任务拆分，补传请使用 main 分支的独立同步工作流。

参考：[Runner 网络要求](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)、[Runner 代理配置](https://docs.github.com/en/actions/how-tos/manage-runners/use-proxy-servers)。
