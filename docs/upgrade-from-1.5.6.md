# 从 1.5.6 升级

当前源码版本为 1.5.8。1.5.6 只安装完整 NSIS 安装包；新版的 ZIP / 分块更新不能替代旧版需要的 EXE。

## 发布契约

- 保留 `ScreenSh-<版本>-Setup.exe`、对应 `.blockmap` 和 `latest.yml`。
- `latest.yml` 的 `files` 和 `path` 指向完整 EXE，两个 `sha512` 与实际安装包一致；`portable` / `incremental` 仅作为附加字段。
- 发布版本必须高于客户端当前版本。构建并发布已提交的完整版本，不能仅改清单中的版本或用未重新构建的安装包冒充当前源码。
- `node app/scripts/check-legacy-release.cjs` 校验本地发布目录；CI 的安装包检查和手动发布入口均执行此检查。它不验证线上发布状态或实际安装成功。

## 下载完成后更新程序退出或超时

1.5.6 的 `main.js` 固定调用自身的 `main/update-installer.cjs`，该模块启动自身携带的 PowerShell 脚本。只有收到 ready 文件后才退出主程序并允许安装。旧脚本未就绪便退出时，新安装包尚未执行，因此修改新版客户端或新版安装包无法远程修复此入口。发布过渡版本也仍会经过同一入口。

2026-11-17 在本机用 1.5.6 Git 标签源码和不可执行的占位安装包复现：退出码 0、无 ready、未启动安装、测试用户数据未改变。进一步用无界面的最小 PowerShell 文件验证：`detached:true` 时脚本没有执行即退出 0，`detached:false` 时正常执行；`stdio` 使用 ignore 或 pipe 不改变结果。旧更新窗口脚本在普通子进程模式下也能生成 ready。使用 Electron 29.4.6 运行隔离复现脚本，同样出现分离进程未生成 ready 的结果。这将本机触发条件收窄到旧启动器的分离进程方式，不代表所有 Windows 环境都会如此；尚未验证真实 1.5.6 安装包到新版的完整升级流程。

可以另做一次性迁移工具，读取并校验旧客户端下载的安装包，以原生程序接管安装并保留数据，从而免去用户查找安装目录、重新下载和操作安装向导。但旧客户端没有调用这个工具的入口，仍需用户启动一次迁移工具。该方案尚未实现，不能称为旧客户端零操作自动更新。已检查的 1.5.6 自动更新和设置页安装入口均调用旧脚本；虽然模块保留 `quitAndInstall` 包装方法，界面没有连接到该备用入口。

恢复步骤：

1. 在旧更新窗口选择进入当前版本，必要时暂时关闭自动更新。
2. 获取正式发布的完整新版 `ScreenSh-<版本>-Setup.exe`，退出 ScreenSh 后运行，覆盖原安装位置；不要先卸载或删除 `data`。
3. 启动新版，核对版本号和原有配置，再启用自动更新。

当前安装代码已有原生更新程序、启动失败备用安装、安装前备份与启动确认逻辑。旧版无法启动脚本的机器仍需上述一次人工交接；之后使用新版更新流程。源码测试通过不等于已验证真实 1.5.6 安装到当前构建的端到端升级。

## 验证

`node app/tests/integration/check-legacy-update-handoff.cjs` 仅用于复现本机旧版交接失败，不能作为跨机器成功升级测试（它预期旧入口失败）。

`node --test app/tests/legacy-release.test.js app/tests/update-installer.test.js app/tests/update-handoff.test.js app/tests/update-cleanup.test.js app/tests/pending-update.test.js app/tests/auto-update.test.js`

正式发布前还应在隔离 Windows 环境中安装真实 1.5.6，保留测试配置，分别验证正常自动交接和失败后的手动覆盖安装，并确认新版本启动及数据保留。
