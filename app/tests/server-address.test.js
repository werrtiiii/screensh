const { test } = require('node:test');
const assert = require('node:assert/strict');

test('server addresses accept omitted protocol without changing the default HTTP/HTTPS port', async () => {
  const { normalizeServerAddress: normalize } = await import('../renderer/server-address.mjs');
  const cases = [
    ['example.com', 'http://example.com'],
    [' 127.0.0.1 ', 'http://127.0.0.1'],
    ['localhost:3000/', 'http://localhost:3000'],
    ['HTTP://EXAMPLE.COM/', 'http://example.com'],
    ['https://example.com', 'https://example.com'],
    ['example.com:80', 'http://example.com'],
    ['https://example.com:443/', 'https://example.com'],
    ['[::1]', 'http://[::1]'],
    ['::1', 'http://[::1]'],
    ['[2001:db8::1]:8080', 'http://[2001:db8::1]:8080'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalize(input), expected, input);
    assert.equal(normalize(normalize(input)), expected, 'normalizing again preserves the same endpoint');
  }
});

test('invalid server addresses cannot silently redirect to a different origin or port', async () => {
  const { normalizeServerAddress: normalize } = await import('../renderer/server-address.mjs');
  for (const input of [null, '', ' ', 'http:///example.com', 'ftp://example.com', 'file:///tmp', 'user:password@example.com',
    'example.com/path', 'example.com?', 'example.com/#', 'example.com:0', 'example.com:65536',
    'example.com:', 'example.com:abc', 'bad host', 'example.com\\path']) {
    assert.throws(() => normalize(input), undefined, String(input));
  }
});

test('port 31012 is only tried after the original address fails, and explicit ports never change', async () => {
  const { serverAddressCandidates, connectServerAddress } = await import('../renderer/server-address.mjs');
  const { EventEmitter } = require('node:events');
  assert.deepEqual(serverAddressCandidates('sh.rn1.me'), ['http://sh.rn1.me', 'https://sh.rn1.me', 'http://sh.rn1.me:31012']);
  assert.deepEqual(serverAddressCandidates('http://host.test'), ['http://host.test', 'http://host.test:31012']);
  assert.deepEqual(serverAddressCandidates('https://host.test'), ['https://host.test', 'https://host.test:31012']);
  assert.deepEqual(serverAddressCandidates('host.test:80'), ['http://host.test', 'https://host.test:80']);
  assert.deepEqual(serverAddressCandidates('https://host.test:443'), ['https://host.test']);
  assert.deepEqual(serverAddressCandidates('[::1]:31012'), ['http://[::1]:31012', 'https://[::1]:31012']);
  assert.deepEqual(serverAddressCandidates('localhost:3000'), ['http://localhost:3000', 'https://localhost:3000']);
  const attempts = [], sockets = [];
  const connect = url => {
    attempts.push(url); const socket = new EventEmitter(); sockets.push(socket);
    socket.disconnect = () => { socket.closed = true; };
    queueMicrotask(() => socket.emit(url.endsWith(':31012') ? 'connect' : 'connect_error'));
    return socket;
  };
  const result = await connectServerAddress('host.test', connect, 50);
  assert.equal(result.url, 'http://host.test:31012');
  assert.equal(attempts.length, 3); assert.ok(sockets.slice(0, 2).every(socket => socket.closed && socket.eventNames().length === 0));
  attempts.length = 0;
  await connectServerAddress('localhost', url => { attempts.push(url); const socket = new EventEmitter(); socket.connected = true; return socket; });
  assert.deepEqual(attempts, ['http://localhost']);
});
test('a bare domain with an explicit TLS port retries HTTPS on that port', async () => {
  const {serverAddressCandidates,connectServerAddress} = await import('../renderer/server-address.mjs');
  const {EventEmitter}=require('node:events');
  const input='sh.4.rn1.me:16667',attempts=[],sockets=[];
  assert.deepEqual(serverAddressCandidates(input),['http://sh.4.rn1.me:16667','https://sh.4.rn1.me:16667']);
  assert.deepEqual(serverAddressCandidates('http://'+input),['http://sh.4.rn1.me:16667']);
  assert.deepEqual(serverAddressCandidates('https://'+input),['https://sh.4.rn1.me:16667']);
  assert.deepEqual(serverAddressCandidates('host.test:443'),['http://host.test:443','https://host.test']);
  const result=await connectServerAddress(input,url=>{
    attempts.push(url);const socket=new EventEmitter();sockets.push(socket);socket.disconnect=()=>{socket.closed=true;};
    queueMicrotask(()=>socket.emit(url.startsWith('https:')?'connect':'connect_error'));return socket;
  },50);
  assert.equal(result.url,'https://sh.4.rn1.me:16667');assert.deepEqual(attempts,serverAddressCandidates(input));
  assert.equal(sockets[0].closed,true);assert.equal(sockets[0].eventNames().length,0);assert.equal(sockets[1].closed,undefined);
});
