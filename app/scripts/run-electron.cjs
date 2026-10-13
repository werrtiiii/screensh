const path = require('path');
const { spawn } = require('child_process');
const script = process.argv[2];
if (!['smoke-electron.cjs', 'smoke-ui.cjs', 'smoke-native.cjs'].includes(script)) throw new Error('Unknown smoke test');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (script === 'smoke-native.cjs') env.ELECTRON_RUN_AS_NODE = '1';
// The managed Windows test environment cannot launch Chromium's sandboxed
// renderer (exit code 49). Keep this workaround scoped to smoke tests; the
// packaged client retains Electron's normal sandbox behavior.
const child = spawn(require('electron'), ['--no-sandbox', path.join(__dirname, script)], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
