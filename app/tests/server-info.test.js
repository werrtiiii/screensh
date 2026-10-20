const {test} = require('node:test');
const assert = require('node:assert/strict');

test('Beijing time uses UTC+8 regardless of the computer timezone and preserves seconds', async () => {
  const {formatBeijingTime} = await import('../renderer/server-info.mjs');
  assert.equal(formatBeijingTime(Date.UTC(2026,9,20,0,0,7)), '2026/10/20 08:00:07');
  assert.equal(formatBeijingTime(Date.UTC(2026,9,20,16,0,0)), '2026/10/21 00:00:00');
});
test('server uptime and age distinguish a restart from original creation and keep unknown legacy dates honest', async () => {
  const {formatServerDuration:duration, formatServerAge:age} = await import('../renderer/server-info.mjs');
  assert.equal(duration(-10),'0秒'); assert.equal(duration(65000),'1分 5秒');
  assert.equal(duration(3661000),'1小时 1分'); assert.equal(duration(18*86400000+7200000),'18天 2小时');
  const now=Date.UTC(2026,9,20);
  assert.equal(age(null,now),'未知'); assert.equal(age(undefined,now),'未知');
  assert.equal(age(now,now),'刚刚'); assert.equal(age(now-180000,now),'3分钟前');
  assert.equal(age(now-31536000000,now),'1年前');
});
