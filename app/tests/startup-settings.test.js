const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createSavedPasswords } = require('../main/saved-passwords.cjs');
const { createLoginStartup } = require('../main/login-startup.cjs');
test('saved passwords are encrypted, scoped by origin and server ID, replaceable and removable', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-passwords-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'passwords.json'),id='a'.repeat(36);
  const crypto={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from([...value].reverse().join('')),decryptString:bytes=>[...bytes.toString()].reverse().join('')};
  const store=createSavedPasswords(file,crypto);
  store.set('http://example.com',id,'secret-password');
  assert.ok(!fs.readFileSync(file,'utf8').includes('secret-password'));
  assert.equal(store.get('http://example.com',id),'secret-password');
  assert.equal(store.get('http://elsewhere.com',id),'');
  assert.equal(store.get('http://example.com','b'.repeat(36)),'');
  assert.equal(createSavedPasswords(file,crypto).get('http://example.com',id),'secret-password');
  store.set('http://example.com',id,'new-secret');assert.equal(store.get('http://example.com',id),'new-secret');
  store.set('http://example.com',id,'');assert.equal(store.get('http://example.com',id),'');
  crypto.isEncryptionAvailable=()=>false;
  assert.throws(()=>store.set('http://example.com',id,'password'),/加密不可用/);
  assert.throws(()=>store.set('file:///',id,'password'),/服务器标识/);
});
test('login startup uses current-user interactive elevated task and passes paths as data', async () => {
  const calls=[];
  const startup=createLoginStartup({exe:'C:\\Program Files\\ScreenSh\\ScreenSh.exe',appPath:'E:\\project with spaces\\app',packaged:true,execute:(exe,args,options,callback)=>{calls.push({exe,args,options});callback(null,args[1]==='enable'?'true\r\n':'false\r\n');}});
  assert.equal(await startup.get(),false);assert.equal(await startup.set(true),true);assert.equal(await startup.set(false),false);
  const call=calls[1];assert.match(call.exe,/screensh-platform\.exe$/);
  assert.equal(call.options.windowsHide,true);assert.deepEqual(call.args,['login','enable','C:\\Program Files\\ScreenSh\\ScreenSh.exe','--startup','C:\\Program Files\\ScreenSh']);
  assert.throws(()=>startup.set('true'),/无效/);
});
test('auto connect is enabled by default but only restores a valid successful server', async t => {
  const saved=new Map();const original=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>saved.get(key)??null};t.after(()=>{if(original)globalThis.localStorage=original;else delete globalThis.localStorage;});
  const {lastConnectedServer}=await import('../renderer/startup-settings.mjs');
  assert.equal(lastConnectedServer(),null);
  const last={url:'http://example.com',userName:'User'};saved.set('lastConnectedServer',JSON.stringify(last));
  assert.deepEqual(lastConnectedServer(),last);saved.set('autoConnectLastServer','false');assert.equal(lastConnectedServer(),null);
  saved.delete('autoConnectLastServer');saved.set('lastConnectedServer',JSON.stringify({...last,url:'file:///etc'}));assert.equal(lastConnectedServer(),null);
});
