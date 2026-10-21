// Windows administrator terminal required. Only the test-owned adapter and
// 10.144.242.0/30 route are created; existing EasyTier instances are untouched.
process.env.SCREENSH_TEST_MIXED_TUN='1';
require('./smoke-no-tun.cjs');
