# 软件图标
- `icon-source.png`：去除外部背景后生成的透明原图。
- `icon.png`：256 像素窗口图标。
- `tray.png`：32 像素托盘图标。
- `icon.ico`：包含 16、20、24、32、40、48、64、128、256 像素的 Windows 图标，供可执行文件、安装及卸载程序使用。
修改原图后执行 `npm run build:icons --prefix app`，使用项目已有 Electron 生成发布素材，无需在线服务。
