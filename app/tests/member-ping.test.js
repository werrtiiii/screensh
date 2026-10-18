const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemberPinger } = require('../main/member-ping.cjs');
test('member Ping uses argument-based hidden execution, parses localized replies and caches results', async () => {
  let calls = 0, time = 100;
  const pinger = createMemberPinger({ now: () => time, execute: (exe, args, options, done) => {
    calls++; assert.match(exe, /PING\.EXE$/); assert.deepEqual(args, ['-4','-n','1','-w','1000','10.144.1.2']); assert.equal(options.windowsHide, true);
    done(null, calls === 1 ? 'Reply from 10.144.1.2: bytes=32 time=32ms TTL=128' : '来自 10.144.1.2 的回复: 字节=32 时间<1ms TTL=128');
  } });
  assert.equal((await pinger.ping('10.144.1.2')).rttMs,32);
  await pinger.ping('10.144.1.2'); assert.equal(calls,1);
  time += 3000; assert.equal((await pinger.ping('10.144.1.2')).rttMs,0.5);
});
test('member Ping rejects invalid targets and never labels timeout/unreachable as zero delay', async () => {
  let calls = 0;
  const pinger = createMemberPinger({ execute: (_exe,_args,_options,done) => { calls++; done(Error('timeout'), ''); } });
  for (const ip of ['127.0.0.1', 'example.com', '10.144.1.2 & whoami', '10.144.1.999', null]) await assert.rejects(pinger.ping(ip), /无效/);
  assert.equal(calls,0); assert.equal((await pinger.ping('10.144.1.2')).rttMs,null);
});
test('member Ping limits concurrent processes and deduplicates in-flight requests', async () => {
  const callbacks=[];
  const pinger=createMemberPinger({execute:(_exe,_args,_options,done)=>callbacks.push(done)});
  const results=Array.from({length:8},(_,i)=>pinger.ping('10.144.1.'+(i+1)));
  assert.equal(pinger.ping('10.144.1.1'),results[0]); assert.equal(callbacks.length,6);
  callbacks[0](null,'time=5ms'); assert.equal(callbacks.length,7);
  callbacks[1](null,'time=6ms'); assert.equal(callbacks.length,8);
  callbacks.slice(2).forEach(done=>done(null,'time=7ms')); await Promise.all(results);
});
