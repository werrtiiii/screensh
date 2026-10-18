const path = require('path');
const { spawn } = require('child_process');
const script = process.argv[2];
const extraScripts = ['smoke-app-presence.cjs'];
if (!extraScripts.includes(script) && !['smoke-ui-design.cjs', 'smoke-capture-previews.cjs', 'smoke-lolping.cjs', 'smoke-electron.cjs', 'smoke-ui.cjs', 'smoke-native.cjs', 'smoke-obs-isolation.cjs', 'smoke-voice.cjs', 'smoke-voice-ui.cjs', 'smoke-mic-meter.cjs', 'smoke-speaking.cjs', 'smoke-reconnect.cjs', 'smoke-accompaniment.cjs', 'smoke-accompaniment-native.cjs', 'smoke-process-audio.cjs', 'smoke-tray.cjs', 'smoke-interactions.cjs', 'smoke-bookmarks.cjs', 'smoke-card-layout.cjs', 'smoke-channel-ui.cjs', 'smoke-startup.cjs'].includes(script)) throw new Error('Unknown smoke test');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (['smoke-native.cjs', 'smoke-obs-isolation.cjs'].includes(script)) env.ELECTRON_RUN_AS_NODE = '1';
// The managed Windows test environment cannot launch Chromium's sandboxed
// renderer (exit code 49). Keep this workaround scoped to smoke tests; the
// packaged client retains Electron's normal sandbox behavior.
const args = env.ELECTRON_RUN_AS_NODE === '1' ? [] : ['--no-sandbox'];
const child = spawn(require('electron'), [...args, path.join(__dirname, '../tests/integration', script)], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
