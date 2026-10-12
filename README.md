# ScreenSh

ScreenSh 是 Windows 屏幕共享客户端，支持频道、成员管理和观看共享画面。客户端使用 Electron、OBS Studio Node、MediaMTX 和 EasyTier；Node.js 信令服务器管理频道、成员和连接信息。屏幕画面由客户端之间传输，不经过信令服务器。

## 目录

- `app/`：Windows 客户端及其构建脚本。
- `server/`：信令服务器、Docker 配置和 [部署教程](server/部署教程.md)。
- `obs-studio-node/`：客户端使用的原生 OBS 模块。
- `.github/workflows/release.yml`：Windows 安装包的 GitHub Release 工作流。

## 下载和使用

从 [GitHub Releases](https://github.com/werrtiiii/screensh/releases) 下载 Windows 安装包。安装后启动 ScreenSh，在首页填写信令服务器地址和名称，再连接频道。首次成功进入新服务器的客户端成为房主。房主可在「服务器设置」中管理连接密码和组网节点。

服务器部署方法见 [部署教程](server/部署教程.md)。客户端和服务端需要使用兼容的频道协议版本；当前服务端 `/health` 返回 `protocol: 2`。

## 本地开发

需要 Node.js 24、Windows x64，以及项目所需的 OBS、EasyTier、MediaMTX、Wintun 等原生资源。原生资源必须在构建前放到 `obs-studio-node/` 和 `app/res/` 的预期位置；发布工作流会检查这些文件。

```powershell
npm ci --prefix server
npm test --prefix server
$env:SCREENSH_EASYTIER_PEERS = '你的节点域名:11010'
npm start --prefix server
```

另开终端启动客户端：

```powershell
npm ci --prefix app
npm test --prefix app
npm run dev --prefix app
```
客户端首页填写 `http://127.0.0.1:3000`。Windows 安装包使用 `npm run pack:win --prefix app` 构建。客户端使用服务器下发的 EasyTier 节点；新服务器没有节点部署配置时会拒绝启动。