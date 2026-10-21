const fs = require('node:fs');
const path = require('node:path');

const requiredResources = ['easytier-core.exe', 'easytier-cli.exe', 'mediamtx.exe', 'wintun.dll', 'Packet.dll', 'screensh-process-audio.exe', 'lolping-hook-helper.exe'];

function collectResources(directory) {
  const files = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
  for (const required of requiredResources) {
    const actual = files.find(file => file.toLowerCase() === required.toLowerCase());
    if (!actual || fs.statSync(path.join(directory, actual)).size === 0) {
      throw new Error('Missing or empty native dependency: ' + path.join(directory, required));
    }
  }
  // Include companion DLLs/drivers, but not the unused res/mediamtx.yml.
  return files.filter(file => requiredResources.some(required => required.toLowerCase() === file.toLowerCase())
    || /\.(dll|sys)$/i.test(file)).sort();
}

module.exports = { collectResources, requiredResources };
