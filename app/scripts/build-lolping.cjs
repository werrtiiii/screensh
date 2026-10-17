const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), source = path.join(root, 'lolping'), vendor = path.join(source, 'vendor');
const output = path.join(source, 'dist');
async function build() {
  fs.mkdirSync(output, { recursive: true });
  for(const obsolete of ['room.html','room.js','room.css'])fs.rmSync(path.join(output,'ui',obsolete),{force:true});
  fs.cpSync(path.join(source, 'ui'), path.join(output, 'ui'), { recursive: true });
  for(const page of ['panel','text']) {
    await esbuild.build({entryPoints:[path.join(vendor,`src/renderer/${page}/main.ts`),path.join(vendor,`src/renderer/${page}/${page}.css`)],outdir:path.join(output,`renderer/${page}`),bundle:true,platform:'browser',target:'chrome122',loader:{'.png':'file'},plugins:[{name:'panel-assets',setup(build){build.onResolve({filter:/^\/ui\//},args=>({path:path.join(vendor,'assets',args.path.slice(1))}));}}]});
    fs.writeFileSync(path.join(output,`renderer/${page}/index.html`),fs.readFileSync(path.join(vendor,`src/renderer/${page}/index.html`),'utf8').replace('./main.ts','./main.js').replace("script-src 'self'", "script-src 'self'; media-src 'self'"));
  }
  await esbuild.build({ entryPoints: [path.join(source, 'settings-tools.ts')], outfile: path.join(output, 'settings-tools.mjs'), bundle: true, platform: 'browser', format: 'esm', target: 'chrome122' });
  await esbuild.build({ entryPoints: [path.join(source, 'core.ts')], outfile: path.join(output, 'main/core.cjs'), bundle: true,
    platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], plugins: [{ name: 'screensh-paths', setup(build) {
      build.onResolve({ filter: /^\.\/paths$/ }, args => ({ path: path.join(source, 'paths.ts') }));
    }}] });
  await esbuild.build({ entryPoints: [path.join(vendor, 'src/preload/overlay.ts')], outfile: path.join(output, 'preload/overlay.cjs'), bundle: true,
    platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] });
  await esbuild.build({ entryPoints: [path.join(source, 'overlay-entry.ts')], outfile: path.join(output, 'renderer/overlay/main.js'), bundle: true,
    platform: 'browser', target: 'chrome122', loader: { '.png': 'file' }, plugins: [{ name: 'absolute-assets', setup(build) {
      build.onResolve({ filter: /^\/ui\// }, args => ({ path: path.join(vendor, 'assets', args.path.slice(1)) }));
    }}] });
  fs.writeFileSync(path.join(output, 'renderer/overlay/index.html'), fs.readFileSync(path.join(vendor, 'src/renderer/overlay/index.html'), 'utf8')
    .replace('./overlay.css', './main.css').replace('./main.ts', './main.js'));
  for (const folder of ['textures', 'sounds', 'emotes', 'ui']) fs.cpSync(path.join(vendor, 'assets', folder), path.join(output, 'renderer', folder), { recursive: true });
  const native = path.join(vendor, 'native/hook-helper'), executable = path.join(root, 'res/lolping-hook-helper.exe');
  const sources = ['main_win', 'hooks_win', 'simulate', 'commands', 'output', 'json', 'decision'].map(name => path.join(native, 'src', name + '.cpp'));
  const newest = Math.max(...fs.readdirSync(path.join(native, 'src')).map(name => fs.statSync(path.join(native, 'src', name)).mtimeMs));
  if (!process.argv.includes('--js-only') && (!fs.existsSync(executable) || fs.statSync(executable).mtimeMs < newest || process.argv.includes('--native'))) {
    if (process.platform !== 'win32') throw Error('The ScreenSh lolPing helper currently builds on Windows');
    let compiler;
    for (const candidate of [process.env.LOLPING_CXX, 'g++', 'C:/mingw64/bin/g++.exe', 'C:/msys64/mingw64/bin/g++.exe', 'C:/msys64/ucrt64/bin/g++.exe', 'C:/ProgramData/chocolatey/lib/mingw/tools/install/mingw64/bin/g++.exe'].filter(Boolean)) {
      if (spawnSync(candidate, ['-std=c++20', '-x', 'c++', '-fsyntax-only', '-'], { input: '#include <thread>\n#include <mutex>\nint main(){std::thread t([]{});t.join();}\n', windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] }).status === 0) { compiler = candidate; break; }
    }
    if (!compiler) throw Error('Install a C++20 MinGW-w64 compiler or set LOLPING_CXX to its g++.exe');
    const result = spawnSync(compiler, ['-std=c++20', '-O2', '-static', '-municode', '-DUNICODE', '-D_UNICODE', '-D_WIN32_WINNT=0x0A00', '-DWINVER=0x0A00', ...sources, '-o', executable, '-luser32'], { windowsHide: true, stdio: 'inherit' });
    if (result.status !== 0) throw Error('lolPing input helper compilation failed');
  }
  console.log('LOLPING_BUILT');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
