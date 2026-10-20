// Convert the approved artwork with the Electron runtime already used by the app.
const fs = require('node:fs');
const path = require('node:path');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), ['--no-sandbox', __filename], { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { app, nativeImage } = require('electron');
app.setPath('userData', path.join(__dirname, '../.runtime-probe/icon-builder'));
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const directory = path.join(__dirname, '../assets/branding');
  const source = nativeImage.createFromPath(path.join(directory, 'icon-source.png'));
  if (source.isEmpty()) throw new Error('图标源文件无法读取');
  const png = size => source.resize({ width: size, height: size, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(directory, 'icon.png'), png(256));
  fs.writeFileSync(path.join(directory, 'tray.png'), png(32));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const frames = sizes.map(png);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + 16 * i;
    header[entry] = header[entry + 1] = sizes[i] % 256;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += frames[i].length;
  }
  fs.writeFileSync(path.join(directory, 'icon.ico'), Buffer.concat([header, ...frames]));
  console.log('APP_ICONS_OK', sizes.join(',')); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
