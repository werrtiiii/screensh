const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

function prepareVoiceHost(bin, dataPath) {
  const files = fs.readdirSync(bin).filter(name => name === 'obs64.exe' || /\.dll$/i.test(name));
  const signature = files.sort().map(name => {
    const stat = fs.statSync(path.join(bin, name));
    return `${name}:${stat.size}:${stat.mtimeMs}`;
  }).join('|');
  const revision = createHash('sha256').update(signature).digest('hex').slice(0, 12);
  const identity = createHash('sha256').update(path.resolve(dataPath)).digest('hex').slice(0, 12);
  const directory = path.join(dataPath, 'native-host', revision);
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, `voice-obs-${identity}.exe`);
  for (const name of files) {
    const source = path.join(bin, name);
    const target = name === 'obs64.exe' ? executable : path.join(directory, name);
    if (fs.existsSync(target)) continue;
    // Keep DLLs beside the executable for the Windows loader. Hard links avoid
    // duplicating installed binaries; different drives use a regular copy.
    try { fs.linkSync(source, target); }
    catch { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); }
  }
  return executable;
}
module.exports = { prepareVoiceHost };
