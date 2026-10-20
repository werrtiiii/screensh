const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto');
const {createChatStore}=require('../chat-store.cjs');
const {createSignalingServer}=require('../server');
const {io:connect}=require('socket.io-client');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const author={id:randomUUID(),name:'Alice'},payload=(text,image)=>({clientId:randomUUID(),text,...(image?{image:{data:image,name:'image.png'}}:{})});
test('chat text and original image bytes persist, paginate and deduplicate without exposing image payloads in history',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-chat-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=createChatStore({directory}),firstPayload=payload('**Hello** <script>',png),first=store.append(author,firstPayload);
  assert.equal(store.append(author,firstPayload).duplicate,true);assert.equal(store.info().count,1);
  store.append(author,payload('Second'));store.append(author,payload('Third'));
  const page=store.history(Infinity,2);assert.deepEqual(page.messages.map(message=>message.text),['Second','Third']);assert.equal(page.hasMore,true);
  assert.equal(store.history(page.messages[0].sequence,2).messages[0].id,first.message.id);
  assert.ok(!JSON.stringify(page).includes('data:image'));
  const restored=createChatStore({directory});assert.equal(restored.info().epoch,store.info().epoch);assert.equal(restored.image(first.message.id).data,png);
  assert.throws(()=>store.append(author,payload('','data:image/png;base64,PHNjcmlwdD4=')),/格式无效/);
  assert.throws(()=>store.append(author,{...payload('x'),clientId:'bad'}),/消息无效/);
  assert.throws(()=>store.append(author,payload('x'.repeat(8001))),/8000/);
});
test('GIF and WebP preserve their original format and storage caps remove oldest data and orphaned files',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-chat-retain-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let now=Date.now();
  const store=createChatStore({directory,now:()=>now});
  const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const first=store.append(author,payload('gif',gif));assert.equal(store.image(first.message.id).data,gif);
  now+=2*86400000;store.configure({days:1,maxMB:0});assert.equal(store.info().count,0);assert.equal(fs.readdirSync(path.join(directory,'media')).length,0);
  store.configure({days:0,maxMB:1});
  const makeLarge=seed=>{const bytes=Buffer.alloc(700000,seed);Buffer.from('RIFF').copy(bytes);Buffer.from('WEBP').copy(bytes,8);return 'data:image/webp;base64,'+bytes.toString('base64');};
  const a=store.append(author,payload('old',makeLarge(1))),b=store.append(author,payload('new',makeLarge(2)));
  assert.equal(store.info().count,1);assert.equal(store.image(b.message.id).data,makeLarge(2));assert.throws(()=>store.image(a.message.id),/过期/);
  assert.equal(fs.readdirSync(path.join(directory,'media')).length,1);assert.ok(store.info().bytes<=1048576);
  const epoch=store.info().epoch;store.clear();assert.notEqual(store.info().epoch,epoch);assert.equal(store.info().count,0);assert.equal(fs.readdirSync(path.join(directory,'media')).length,0);
});
test('server-wide chat includes members outside channels, excludes outsiders, and grants record administration only to host',async t=>{
  const {server,io}=createSignalingServer({initialPeers:'test.example:11010'}),sockets=[];await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{sockets.forEach(socket=>socket.disconnect());await new Promise(resolve=>io.close(resolve));});
  const request=(socket,event,payload={})=>new Promise((resolve,reject)=>socket.timeout(15000).emit(event,payload,(error,result)=>error?reject(error):resolve(result)));
  async function client(name,index,join=true){const socket=connect('http://127.0.0.1:'+server.address().port,{transports:['websocket'],reconnection:false});sockets.push(socket);await new Promise(resolve=>socket.once('connect',resolve));if(join)assert.equal((await request(socket,'join-server',{userName:name,identity:randomBytes(32).toString('hex'),virtualIp:'10.144.99.'+index,channelId:null,easytierPeers:['tcp://test.example:11010']})).ok,true);return socket;}
  const host=await client('Host',1),member=await client('Member',2),outsider=await client('Outsider',3,false);
  assert.equal((await request(outsider,'chat-history')).ok,false);assert.equal((await request(outsider,'chat-send',payload('unauthorized'))).ok,false);
  const seen=new Promise(resolve=>member.once('chat-message',resolve));const sent=await request(host,'chat-send',payload('server-wide',png));assert.equal(sent.ok,true);assert.equal((await seen).message.id,sent.message.id);
  assert.equal((await request(member,'chat-image',{id:sent.message.id})).data,png);
  assert.equal((await request(outsider,'chat-image',{id:sent.message.id})).ok,false);
  await request(host,'set-admin',{socketId:member.id,enabled:true});
  assert.equal((await request(member,'chat-settings',{days:1,maxMB:1})).ok,false);assert.equal((await request(member,'chat-clear')).ok,false);
  assert.equal((await request(host,'chat-settings',{days:7,maxMB:16})).ok,true);
  const reset=new Promise(resolve=>member.once('chat-reset',resolve));assert.equal((await request(host,'chat-clear')).ok,true);assert.equal((await reset).count,0);
  assert.equal((await request(member,'chat-history')).messages.length,0);
  // Exercise the actual WebSocket payload cap as well as the decoded image limit.
  await request(host,'chat-settings',{days:7,maxMB:64});
  const bytes=Buffer.alloc(20*1048576);Buffer.from(png.split(',')[1],'base64').copy(bytes);
  const large='data:image/png;base64,'+bytes.toString('base64');
  const uploaded=await request(host,'chat-send',payload('20MB image',large));
  assert.equal(uploaded.ok,true);assert.equal(uploaded.message.image.bytes,20*1048576);
  assert.equal((await request(member,'chat-image',{id:uploaded.message.id})).data,large);
  const oversized=Buffer.concat([bytes,Buffer.from([0])]);
  const rejected=await request(host,'chat-send',payload('too large','data:image/png;base64,'+oversized.toString('base64')));
  assert.equal(rejected.ok,false);assert.match(rejected.message,/20MB/);
});
