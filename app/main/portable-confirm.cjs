let fs;try{fs=require('original-fs');}catch{fs=require('node:fs');}
const path = require('node:path');
function confirmPortableStartup(root, version) {
  const directory = path.join(root, 'data/updates/transactions');
  const confirming=[];
  require('./update-blocks.cjs').noLinks(directory);
  if (!fs.existsSync(directory)) return confirming;
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const transaction = path.join(directory, entry.name);
    let journal;
    try { journal = JSON.parse(fs.readFileSync(path.join(transaction, 'journal.json'), 'utf8').replace(/^\uFEFF/,'')); } catch { continue; }
    if (journal.phase === 'applied' && journal.version === version && path.resolve(journal.root).toLowerCase() === path.resolve(root).toLowerCase()) {
      fs.writeFileSync(path.join(transaction, 'confirmed'), version, {mode:0o600});confirming.push(entry.name);
    }
  }
  return confirming;
}
module.exports = {confirmPortableStartup};
