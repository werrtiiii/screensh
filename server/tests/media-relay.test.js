const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {io:connect}=require('socket.io-client');const {createSignalingServer}=require('../server');
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>socket.timeout(3000).emit(event,payload,(error,result)=>error?reject(error):resolve(result)));
async function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-external-relay-')),stateFile=path.join(directory,'state.json');const runtime=createSignalingServer({stateFile,initialPeers:'test.example:11010'});await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));const clients=[];t.after(async()=>{clients.forEach(socket=>socket.disconnect());await new Promise(resolve=>runtime.io.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
async function socket(){const client=connect('http://127.0.0.1:'+runtime.server.address().port,{transports:['websocket'],forceNew:true});clients.push(client);await new Promise(resolve=>client.once('connect',resolve));return client;}
async function member(name,ip){const client=await socket(),identity=randomBytes(32).toString('hex');const access=await request(client,'check-access',{userName:name,identity});const joined=await request(client,'join-server',{userName:name,virtualIp:ip,identity,easytierPeers:access.easytierPeers,networkRevision:access.network?.revision});assert.equal(joined.ok,true,joined.message);return client;}
async function auth(entry){return (await fetch('http://127.0.0.1:'+runtime.server.address().port+'/media-relay/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry)})).status;}
return {member,socket,stateFile,auth};}
const config={name:'existing-network',secret:'network-test-secret',relayHost:'10.126.126.1',relayPort:8889};
test('external settings are owner-only, persist and release network credentials only after access validation',async t=>{
const f=await fixture(t),owner=await f.member('Owner','10.144.1.1'),member=await f.member('Member','10.144.1.2');
assert.equal((await request(member,'get-network-settings')).ok,false);assert.equal((await request(member,'set-network-settings',config)).ok,false);
const initial=await request(owner,'switch-channel',{channelId:'main'});assert.equal(initial.videoRelay.mode,'external');assert.equal(initial.videoRelay.ready,false);
const changed=await request(owner,'set-network-settings',config);assert.equal(changed.ok,true);assert.equal(changed.videoRelay.ready,true);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).networkSettings.secret,config.secret);
const visitor=await f.socket(),info=await request(visitor,'server-info');assert.equal(JSON.stringify(info).includes(config.secret),false);
await request(owner,'set-server-password',{enabled:true,password:'access-test-password'});
const denied=await request(visitor,'check-access',{userName:'Visitor',identity:randomBytes(32).toString('hex')});assert.equal(denied.ok,false);assert.equal(JSON.stringify(denied).includes(config.secret),false);
const access=await request(visitor,'check-access',{userName:'Visitor',identity:randomBytes(32).toString('hex'),password:'access-test-password'});assert.equal(access.network.name,config.name);assert.equal(access.network.secret,config.secret);assert.equal(access.network.dhcp,true);
const snapshot=await request(owner,'switch-channel',{channelId:'main'});assert.equal(JSON.stringify(snapshot).includes(config.secret),false);
assert.equal((await request(owner,'set-network-settings',{...config,relayHost:'8.8.8.8'})).ok,false);
});
test('external relay auth scopes tokens to publisher, channel and stream; configuration does not spawn services',async t=>{
const f=await fixture(t),owner=await f.member('Owner','10.144.1.1');await request(owner,'set-network-settings',config);const viewer=await f.member('Viewer','10.126.126.2');
const lease=await request(owner,'prepare-relay-share');assert.equal(lease.host,config.relayHost);assert.equal(lease.ok,true);const publish={protocol:'webrtc',action:'publish',path:lease.path,token:lease.token};assert.equal(await f.auth(publish),204);
assert.equal(await f.auth({...publish,token:lease.token+'x'}),403);assert.equal(await f.auth({...publish,action:'read'}),403);
assert.equal((await request(owner,'start-sharing',{relayPath:lease.path})).ok,true);
const view=await request(viewer,'get-relay-view',{target:owner.id}),self=await request(owner,'get-relay-view',{target:owner.id});assert.equal(self.ok,true);const read={protocol:'webrtc',action:'read',path:view.path,token:view.token};assert.equal(await f.auth(read),204);
const channel=(await request(owner,'create-channel',{name:'Other'})).channel.id;await request(viewer,'switch-channel',{channelId:channel});assert.equal(await f.auth(read),403);
await request(owner,'stop-sharing');assert.equal(await f.auth(publish),403);
const disabled=await request(owner,'set-video-relay',{enabled:false});assert.equal(disabled.videoRelay.ready,false);assert.equal((await request(owner,'prepare-relay-share')).ok,false);
});

test('owner can select direct WHIP/WHEP and switching endpoints revokes the old relay lease',async t=>{
  const f=await fixture(t),owner=await f.member('Owner','10.144.1.1');
  const direct={...config,relayTransport:'direct',relayHost:'',relayUrl:'https://video.example.com:18889/'};
  const updated=await request(owner,'set-network-settings',direct);assert.equal(updated.ok,true,updated.message);assert.equal(updated.videoRelay.transport,'direct');assert.equal(updated.videoRelay.host,'video.example.com');assert.equal(updated.videoRelay.ready,true);
  const viewer=await f.member('Viewer','10.144.1.2');
  const lease=await request(owner,'prepare-relay-share');assert.equal(lease.url,'https://video.example.com:18889');assert.equal(lease.transport,'direct');assert.equal(lease.port,18889);
  await request(owner,'start-sharing',{relayPath:lease.path});
  const view=await request(viewer,'get-relay-view',{target:owner.id});assert.equal(view.url,lease.url);assert.equal(await f.auth({protocol:'webrtc',action:'read',path:view.path,token:view.token}),204);
  const snapshot=await request(viewer,'switch-channel',{channelId:'main'});assert.equal(snapshot.users.find(u=>u.socketId===owner.id).videoRelay.url,lease.url);
  const oldAuth={protocol:'webrtc',action:'publish',path:lease.path,token:lease.token};
  assert.equal(await f.auth(oldAuth),204);
  await request(owner,'set-network-settings',config);assert.equal(await f.auth(oldAuth),403);assert.equal((await request(viewer,'get-relay-view',{target:owner.id})).ok,false);
  for(const relayUrl of ['ftp://example.com','http://user:pass@example.com','https://example.com/path','https://example.com?secret=x'])assert.equal((await request(owner,'set-network-settings',{...direct,relayUrl})).ok,false);
});
