const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../dist/win-unpacked');
const resources = path.join(root, 'resources');
for (const file of ['ScreenSh.exe', 'resources/mediamtx.yml', 'resources/easytier-core.exe',
  'resources/mediamtx.exe', 'resources/wintun.dll', 'resources/Packet.dll',
  'resources/app.asar.unpacked/node_modules/obs-studio-node/obs_studio_client.node']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Installer is missing ${file}`);
}

const manifest = path.join(resources, 'app.asar', 'package.json');
const probe = `
  const { createRequire } = require('node:module');
  const load = createRequire(${JSON.stringify(manifest)});
  const { ObsEngine } = load('./obs-engine.js');
  const engine = new ObsEngine(process.env.TEMP || process.cwd());
  try {
    engine.init();
    if (!engine.osn.ServiceFactory.types().includes('whip_custom')) throw new Error('WHIP plugin is missing');
    console.log('PACKAGED_OBS_OK');
  } finally { engine.shutdown(); }
`;
const result = spawnSync(require('electron'), ['-e', probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
  encoding: 'utf8', timeout: 60000,
});
if (result.error || result.status !== 0 || !result.stdout.includes('PACKAGED_OBS_OK')) {
  throw result.error || new Error(`Packaged OBS failed: ${result.stderr || result.stdout}`);
}
console.log(result.stdout.trim());
