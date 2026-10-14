const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native/process-audio.cpp'), output = path.join(root, 'res/screensh-process-audio.exe');
fs.mkdirSync(path.dirname(output), { recursive: true });
const candidates = ['g++', 'C:/mingw64/bin/g++.exe', 'C:/msys64/mingw64/bin/g++.exe', 'C:/msys64/ucrt64/bin/g++.exe', 'C:/ProgramData/chocolatey/lib/mingw/tools/install/mingw64/bin/g++.exe'];
for (const compiler of candidates) {
  const probe = spawnSync(compiler, ['--version'], { windowsHide: true, stdio: 'ignore' });
  if (probe.status !== 0) continue;
  const result = spawnSync(compiler, ['-std=c++17', '-O2', '-static', source, '-o', output, '-lole32', '-luuid'], { windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  console.log('PROCESS_AUDIO_BUILT', output); process.exit(0);
}
throw new Error('Install a MinGW-w64 compiler to build the process audio helper');
