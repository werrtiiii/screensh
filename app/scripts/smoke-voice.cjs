const { app, BrowserWindow } = require('electron');
const path = require('path');
const { VoiceRuntime } = require('../voice-runtime.cjs');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', path.join(__dirname, '..', '.runtime-probe', 'voice-' + process.pid));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const runtime = new VoiceRuntime(path.join(app.getPath('userData'), 'obs'), path.join(__dirname, '..', 'res', 'mediamtx.exe'), path.join(__dirname, '..', 'mediamtx.yml'), error => console.error(error));
  let window;
  const timeout = setTimeout(() => { console.error('VOICE_SMOKE_TIMEOUT'); app.exit(1); }, 60000);
  try {
    const devices = await runtime.devices();
    if (!devices.length) throw new Error('没有可用的 OBS 麦克风设备');
    console.log('VOICE_DEVICES_OK', devices.length);
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(path.join(__dirname, 'smoke-voice.html'));
    await runtime.start('default');
    const result = await window.webContents.executeJavaScript('window.voiceProbe()');
    console.log('VOICE_TRANSPORT_OK', JSON.stringify(result));
    if (!(result.energy > 0)) console.warn('音频能量为零：仅验证传输，不能证明麦克风可听。请运行 smoke-mic-meter.cjs 并对麦克风说话。');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { window?.destroy(); await runtime.stop(); clearTimeout(timeout); app.exit(process.exitCode || 0); }
});
