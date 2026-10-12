const fs = require('node:fs');
const path = require('node:path');

const keptPlugins = new Set([
  'image-source', 'obs-ffmpeg', 'obs-filters', 'obs-transitions', 'obs-nvenc',
  'obs-qsv11', 'obs-outputs', 'obs-webrtc', 'obs-x264', 'rtmp-services',
  'win-capture', 'win-wasapi',
]);
function pruneObs(root) {
  if (!fs.existsSync(path.join(root, 'obs_studio_client.node'))) {
    throw new Error('OBS native module is missing from the unpacked installer');
  }
  let removedBytes = 0;
  function remove(target) {
    if (fs.statSync(target).isFile()) removedBytes += fs.statSync(target).size;
    fs.rmSync(target, { recursive: true, force: true });
  }
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep);
      if (/\.(pdb|lib|exp|ilk|obj)$/i.test(entry.name)
        || (relative[0] === 'obs-plugins' && relative[1] === '64bit' && relative.length === 3
          && !keptPlugins.has(path.basename(entry.name, '.dll')))
        || (relative[0] === 'data' && relative[1] === 'obs-plugins' && relative.length === 3
          && !keptPlugins.has(entry.name))) {
        remove(full);
      } else if (entry.isDirectory()) {
        visit(full);
      }
    }
  }
  visit(root);
  return removedBytes;
}

exports.default = async context => {
  const root = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'obs-studio-node');
  const removedBytes = pruneObs(root);
  console.log(`Removed ${(removedBytes / 1024 / 1024).toFixed(1)} MiB of unused OBS files`);
};

exports.pruneObs = pruneObs;
