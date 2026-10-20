const {test} = require('node:test');
const assert = require('node:assert/strict');
function storageOf(entries = []) {
  const values = new Map(entries);
  return {get length() {return values.size;}, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

test('a server keeps one local identity across address changes and remains isolated from other servers', async () => {
  const {serverIdentity} = await import('../renderer/server-identity.mjs');
  const storage = storageOf(), serverId = 'a'.repeat(36), otherId = 'b'.repeat(36);
  const identity = '1'.repeat(64);
  assert.equal(serverIdentity(storage, serverId), null);
  assert.equal(serverIdentity(storage, serverId, () => identity), identity);
  storage.setItem('serverIdentity:https://new-domain.test:443:' + serverId, '2'.repeat(64));
  assert.equal(serverIdentity(storage, serverId, () => {throw Error('must reuse');}), identity);
  assert.equal(serverIdentity(storage, otherId), null);
  assert.equal(serverIdentity(storage, otherId, () => '3'.repeat(64)), '3'.repeat(64));
});

test('legacy identity migrates once and conflicting old credentials remain recoverable', async () => {
  const {serverIdentity} = await import('../renderer/server-identity.mjs');
  const serverId = 'a'.repeat(36), identity = '1'.repeat(64), duplicate = '2'.repeat(64);
  const oldKey = 'serverIdentity:http://old.test:31012:' + serverId;
  const duplicateKey = 'serverIdentity:https://alias.test:' + serverId;
  const storage = storageOf([[oldKey, identity], [duplicateKey, duplicate]]);
  assert.equal(serverIdentity(storage, serverId, () => {throw Error('must migrate');}), identity);
  assert.equal(storage.getItem('serverIdentity:' + serverId), identity);
  assert.equal(storage.getItem(duplicateKey), duplicate);
  assert.equal(serverIdentity(storage, serverId), identity);
});

test('invalid credentials and unrelated local storage entries cannot become identities', async () => {
  const {serverIdentity} = await import('../renderer/server-identity.mjs');
  const serverId = 'a'.repeat(36);
  const storage = storageOf([['serverIdentity:http://old.test:' + serverId, 'invalid'], ['other:' + serverId, '1'.repeat(64)]]);
  assert.equal(serverIdentity(storage, serverId), null);
  assert.throws(() => serverIdentity(storage, '../bad'), /服务器标识/);
  assert.throws(() => serverIdentity(storage, serverId, () => 'invalid'), /身份凭据/);
});
