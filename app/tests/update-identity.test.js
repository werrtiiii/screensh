const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('a build changes update identity only within its own version', () => {
  const { updateKey, compareUpdateKeys, parseUpdateKey } = require('../main/update-identity.cjs');
  assert.equal(updateKey({version:'1.5.9'}), '1.5.9');
  assert.equal(updateKey({version:'1.5.9',build:1}), '1.5.9');
  assert.equal(updateKey({version:'1.5.9',build:2}), '1.5.9-b2');
  assert.deepEqual(parseUpdateKey('1.5.9-b20'), {version:'1.5.9',build:20});
  assert.ok(compareUpdateKeys('1.5.9-b10','1.5.9-b2') > 0);
  assert.ok(compareUpdateKeys('1.5.9-b999','1.6.0') < 0);
  assert.equal(compareUpdateKeys('1.5.9','1.5.9'), 0);
  for (const key of ['1.5.9-b1','1.5.9-b02','1.5.9-b0','1.5.9-b9007199254740992','1.5.9-b2/../', '1.5.9+2']) assert.equal(parseUpdateKey(key), null);
});

test('hotfix packaging validates the embedded build and leaves the legacy index alone', {skip:process.platform!=='win32'}, async t => {
  const { packageUpdate } = require('../scripts/package-update.cjs');
  const { parseManifest } = require('../main/update-blocks.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-hotfix-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'unpacked'),dist=path.join(root,'dist'),app=path.join(root,'app');
  for(const folder of [path.join(source,'resources'),dist,app])fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(source,'ScreenSh.exe'),'fixture executable');
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version:'9.0.0',screenshBuild:2}));
  await require('@electron/asar').createPackage(app,path.join(source,'resources/app.asar'));
  const latest=path.join(dist,'latest.yml');fs.writeFileSync(latest,'legacy index');
  const args={source,dist,version:'9.0.0'};
  await assert.rejects(packageUpdate({...args,build:3}),/does not match/);
  const zip=await packageUpdate({...args,build:2});
  const index=JSON.parse(fs.readFileSync(path.join(dist,'ScreenSh-9.0.0-hotfix.json'),'utf8'));
  assert.deepEqual(index.portable,zip);assert.equal(index.build,2);
  assert.equal(fs.statSync(path.join(dist,zip.url)).size,zip.size);
  const manifest=parseManifest(fs.readFileSync(path.join(dist,index.incremental.url)),'9.0.0-b2');
  assert.equal(manifest.pack.url,'ScreenSh-9.0.0-b2-Blocks.bin');
  assert.equal(fs.readFileSync(latest,'utf8'),'legacy index');
});
