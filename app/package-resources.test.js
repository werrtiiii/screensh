const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectResources, requiredResources } = require('./scripts/package-resources.cjs');

function fixture(t, missing) {
  const base = path.resolve(__dirname, '.runtime-probe');
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'package-resources-'));
  t.after(() => {
    if (path.dirname(directory) !== base) throw new Error('Invalid cleanup path');
    fs.rmSync(directory, { recursive: true });
  });
  for (const name of requiredResources) if (name !== missing) fs.writeFileSync(path.join(directory, name), 'fixture');
  return directory;
}

test('packaging rejects missing Packet.dll even if the development system provides it', t => {
  assert.throws(() => collectResources(fixture(t, 'Packet.dll')), /Packet\.dll/);
});
test('packaging includes companion DLLs and drivers but excludes stale config and debug files', t => {
  const directory = fixture(t);
  for (const file of ['NewDependency.dll', 'WinDivert32.sys', 'mediamtx.yml', 'native.pdb']) fs.writeFileSync(path.join(directory, file), 'fixture');
  assert.deepEqual(collectResources(directory), [...requiredResources, 'NewDependency.dll', 'WinDivert32.sys'].sort());
});
test('packaging rejects empty native resources', t => {
  const directory = fixture(t);
  fs.writeFileSync(path.join(directory, 'wintun.dll'), '');
  assert.throws(() => collectResources(directory), /wintun\.dll/);
});
