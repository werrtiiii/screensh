const {test}=require('node:test'),assert=require('node:assert/strict');
test('chat links only open HTTP and HTTPS without embedded credentials',async()=>{
  const {safeChatLink}=await import('../renderer/chat-markup.mjs');
  assert.equal(safeChatLink('https://example.com'),'https://example.com/');
  assert.equal(safeChatLink('http://example.com:31012/path?q=1'),'http://example.com:31012/path?q=1');
  for(const value of ['javascript:alert(1)','data:text/html,<script>','file:///C:/Windows','https://user:password@example.com','not a URL','https://example.com/'+'x'.repeat(2048)])assert.equal(safeChatLink(value),null);
});
