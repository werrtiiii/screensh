// Offline portable packaging using the installed Electron runtime.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('请在 Windows x64 上打包');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const name = `ScreenSh-${manifest.version}-win-x64-${stamp}`;
const dist = path.join(root, 'dist');
const output = path.join(dist, name);
if (fs.existsSync(output)) throw new Error(`输出目录已存在：${output}`);
const runtime = path.dirname(require.resolve('electron/package.json'));
for (const file of ['easytier-core.exe', 'mediamtx.exe', 'wintun.dll']) {
  if (!fs.existsSync(path.join(root, 'res', file))) throw new Error(`缺少 app/res/${file}`);
}
fs.mkdirSync(output, { recursive: true });
const copy = (from, to, filter) => fs.cpSync(from, to, { recursive: true, dereference: true, filter });
// ScreenSh uses native screen/window capture, not OBS browser/media/device sources.
const obsPlugins = new Set(['image-source', 'obs-ffmpeg', 'obs-filters', 'obs-transitions', 'obs-nvenc', 'obs-qsv11', 'obs-outputs', 'obs-webrtc', 'obs-x264', 'rtmp-services', 'win-capture', 'win-wasapi']);
function dependencyFilter(source, name, file) {
  if (['node_modules', '.git'].includes(path.basename(file)) || /\.(pdb|lib)$/i.test(file)) return false;
  if (name !== 'obs-studio-node') return true;
  const relative = path.relative(source, file).split(path.sep);
  if (relative[0] === 'obs-plugins' && relative[1] === '64bit' && relative.length >= 3) {
    return obsPlugins.has(path.basename(relative[2], '.dll'));
  }
  if (relative[0] === 'data' && relative[1] === 'obs-plugins' && relative.length >= 3) return obsPlugins.has(relative[2]);
  return true;
}
console.log('复制 Electron...');
copy(path.join(runtime, 'dist'), output, file => path.basename(file) !== 'default_app.asar');
fs.renameSync(path.join(output, 'electron.exe'), path.join(output, 'ScreenSh.exe'));
console.log('设置启动时请求管理员权限...');
const executable = path.join(output, 'ScreenSh.exe');
const rcedit = path.join(path.dirname(require.resolve('rcedit/package.json')), 'bin', 'rcedit-x64.exe');
const edit = spawnSync(rcedit, [executable, '--set-requested-execution-level', 'requireAdministrator'], {
  stdio: 'inherit', windowsHide: true,
});
if (edit.error || edit.status !== 0) throw edit.error || new Error('写入管理员权限声明失败');
const embeddedManifest = fs.readFileSync(executable).toString('utf8');
if (!/<requestedExecutionLevel\b[^>]*level=["']requireAdministrator["']/.test(embeddedManifest)) {
  throw new Error('打包文件缺少管理员权限声明');
}
const resources = path.join(output, 'resources');
const appDir = path.join(resources, 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const file of ['main.js', 'preload.js', 'managed-process.js', 'peer-test.js', 'obs-engine.js', 'obs-constants.js', 'capture-sources.js', 'mediamtx.yml', 'renderer']) {
  copy(path.join(root, file), path.join(appDir, file));
}
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, description: manifest.description,
  main: manifest.main, type: manifest.type, license: manifest.license,
}, null, 2));

function locate(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (dir === path.dirname(dir)) throw new Error(`未安装依赖：${name}`);
  }
}
function copyDependency(name, from, parent, ancestors = []) {
  const source = locate(name, from);
  if (ancestors.includes(source)) throw new Error(`检测到循环依赖：${name}`);
  const target = path.join(parent, 'node_modules', name);
  console.log(`复制依赖 ${name}...`);
  copy(source, target, file => dependencyFilter(source, name, file));
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies || {})) copyDependency(dependency, source, target, [...ancestors, source]);
}
for (const name of Object.keys(manifest.dependencies)) copyDependency(name, root, appDir);
for (const file of ['easytier-core.exe', 'mediamtx.exe', 'wintun.dll']) copy(path.join(root, 'res', file), path.join(resources, file));
fs.writeFileSync(path.join(output, '使用说明.md'), `# ScreenSh Windows 便携版

1. 将整个压缩包解压到本地目录，勿只复制 ScreenSh.exe。
2. 双击 ScreenSh.exe，在 Windows 权限确认窗口中选择“是”，以便 EasyTier 创建虚拟网卡。
3. 主页默认信令服务器为 https://sh.rn1.me；可在设置中修改，所有成员需使用同一信令服务。
4. 检查 EasyTier 组网节点，创建或加入同一个房间。
5. 共享者选择显示器/窗口开始共享，其他成员点击观看共享。

目标系统：Windows 10/11 x64。不需要安装 Node.js、npm 或 OBS。
如果提示缺少 VCRUNTIME/MSVCP DLL，请安装微软 Visual C++ 2015–2022 x64 运行库。
服务器需另行运行本项目 server；客户端包不包含信令服务。
防火墙需允许客户端通信：信令服务 TCP 3000（默认），共享端虚拟网卡 TCP 8889、UDP/TCP 8189。
用户设置保存在用户账户的应用数据目录中，不随压缩包分发。
`);
console.log('压缩便携版...');
const zip = path.join(dist, `${name}.zip`);
const result = spawnSync('tar.exe', ['-a', '-c', '-f', zip, '-C', dist, name], { stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) throw result.error || new Error('ZIP 创建失败，已生成的便携版目录可直接使用');
console.log(`打包完成：${zip}`);


