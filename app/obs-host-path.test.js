const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareVoiceHost } = require('./obs-host-path');

test('isolated OBS host carries DLLs, reuses files and separates profiles and binary revisions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-host-'));
  try {
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'obs64.exe'), 'host');
    fs.writeFileSync(path.join(bin, 'obs.dll'), 'library');
    fs.writeFileSync(path.join(bin, 'unrelated.txt'), 'ignore');
    const first = prepareVoiceHost(bin, path.join(root, 'profile1'));
    assert.notEqual(path.basename(first), 'obs64.exe');
    assert.equal(fs.readFileSync(first, 'utf8'), 'host');
    assert.equal(fs.readFileSync(path.join(path.dirname(first), 'obs.dll'), 'utf8'), 'library');
    assert.equal(fs.existsSync(path.join(path.dirname(first), 'unrelated.txt')), false);
    assert.equal(prepareVoiceHost(bin, path.join(root, 'profile1')), first);
    assert.notEqual(path.basename(prepareVoiceHost(bin, path.join(root, 'profile2'))), path.basename(first));
    fs.writeFileSync(path.join(bin, 'new.dll'), 'new library');
    assert.notEqual(prepareVoiceHost(bin, path.join(root, 'profile1')), first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
