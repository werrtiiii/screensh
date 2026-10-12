// Checks the shipped runtime and native dependency without loading workspace dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectResources } = require('./package-resources.cjs');
if (!process.argv[2]) throw new Error('Usage: node scripts/check-package.cjs <package directory> [--dependencies-only]');
const output = path.resolve(process.argv[2]);
const appDir = path.join(output, 'resources', 'app');
const probes = path.resolve(__dirname, '../.runtime-probe');
fs.mkdirSync(probes, { recursive: true });
const temporary = fs.mkdtempSync(path.join(probes, 'package-check-'));
const resources = path.join(output, 'resources');
collectResources(resources);
for (const name of ['ScreenSh.exe', 'resources/easytier-core.exe', 'resources/wintun.dll', 'resources/mediamtx.exe', 'resources/app/mediamtx.yml']) {
  if (!fs.existsSync(path.join(output, name))) throw new Error(`打包文件缺失：${name}`);
}
// Load shipped native executables without contacting peers or creating adapters.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PATH|NODE_PATH|ET_.*)$/i.test(key)));
cleanEnv.Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
for (const name of ['easytier-core.exe', 'mediamtx.exe']) {
  const result = spawnSync(path.join(resources, name), ['--version'], {
    cwd: temporary, env: cleanEnv, windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    const code = Number.isInteger(result.status) ? '0x' + (result.status >>> 0).toString(16).toUpperCase() : result.signal;
    throw new Error(name + ' startup failed (' + code + '): ' + (result.error?.message || result.stderr || 'Check bundled DLLs and system runtime'));
  }
  console.log('PACKAGED_CLI_OK', name, result.stdout.trim());
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
  cwd: temporary, env: { ...cleanEnv, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit', timeout: 60000,
});
if (result.error || result.status !== 0) throw result.error || new Error('打包原生依赖检查失败');
