const validIdentity = value => /^[a-f0-9]{64}$/.test(value || '');

// The server UUID is persistent across domains, ports and protocol changes.
// Keep old address-scoped entries as migration backups and presence address bindings.
export function serverIdentity(storage, serverId, create) {
  if (!/^[a-f0-9-]{36}$/.test(serverId)) throw new Error('无效的服务器标识');
  const key = 'serverIdentity:' + serverId;
  const existing = storage.getItem(key);
  if (validIdentity(existing)) return existing;
  for (let i = 0; i < storage.length; i++) {
    const legacyKey = storage.key(i);
    if (!legacyKey?.startsWith('serverIdentity:') || !legacyKey.endsWith(':' + serverId)) continue;
    const identity = storage.getItem(legacyKey);
    if (!validIdentity(identity)) continue;
    storage.setItem(key, identity);
    return identity;
  }
  if (!create) return null;
  const identity = create();
  if (!validIdentity(identity)) throw new Error('无效的身份凭据');
  storage.setItem(key, identity);
  return identity;
}
