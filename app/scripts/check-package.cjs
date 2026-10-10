// Checks the shipped runtime and native dependency without loading workspace dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const output = path.resolve(process.argv[2]);
const appDir = path.join(output, 'resources', 'app');
const temporary = path.resolve(__dirname, '../.runtime-probe/package-check');
fs.mkdirSync(temporary, { recursive: true });
for (const name of ['ScreenSh.exe', 'resources/easytier-core.exe', 'resources/wintun.dll', 'resources/mediamtx.exe', 'resources/app/mediamtx.yml']) {
  if (!fs.existsSync(path.join(output, name))) throw new Error(`打包文件缺失：${name}`);
}
const probe = `
  const { createRequire } = require('module');
  const load = createRequire(${JSON.stringify(path.join(appDir, 'package.json'))});
  const { ObsEngine } = load('./obs-engine.js');
  const engine = new ObsEngine(${JSON.stringify(temporary)});
  try {
    load('socket.io-client');
    engine.init();
    if (!engine.osn.ServiceFactory.types().includes('whip_custom')) throw new Error('Missing WHIP plugin');
    const source = engine.osn.InputFactory.create('color_source_v3', 'package-check', {width: 640, height: 360});
    if (source.width !== 640 || source.height !== 360) throw new Error('Native source failed');
    source.release();
    console.log('PACKAGED_NATIVE_OK', load.resolve('obs-studio-node'));
  } finally { engine.shutdown(); }
`;
// UAC executables cannot be launched by non-elevated spawnSync. In this mode,
// use the same installed Electron version to check dependencies from the package.
const dependencyOnly = process.argv.includes('--dependencies-only');
const executable = dependencyOnly ? require('electron') : path.join(output, 'ScreenSh.exe');
if (dependencyOnly) console.log('Checking packaged dependencies with the build Electron runtime (not a UAC launch test)');
const result = spawnSync(executable, ['-e', probe], {
  cwd: temporary, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit', timeout: 60000,
});
if (result.error || result.status !== 0) throw result.error || new Error('打包原生依赖检查失败');
