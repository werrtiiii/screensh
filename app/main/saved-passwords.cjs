const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
function createSavedPasswords(file, safeStorage) {
  function key(url, serverId) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== url || !/^[a-f0-9-]{36}$/.test(serverId)) throw new Error('无效的服务器标识');
    return createHash('sha256').update(url + ':' + serverId).digest('hex');
  }
  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }
  return {
    get(url, serverId) {
      const record = read()[key(url, serverId)];
      if (!record || !safeStorage.isEncryptionAvailable()) return '';
      try { return safeStorage.decryptString(Buffer.from(record, 'base64')); } catch { return ''; }
    },
    set(url, serverId, password) {
      const id = key(url, serverId);
      if (typeof password !== 'string' || password.length > 128) throw new Error('无效的服务器密码');
      const records = read();
      if (password) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法保存服务器密码');
        records[id] = safeStorage.encryptString(password).toString('base64');
      } else delete records[id];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(records), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    },
  };
}
module.exports = { createSavedPasswords };
