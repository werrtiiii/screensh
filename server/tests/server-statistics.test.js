const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {randomBytes} = require('node:crypto');
const {io:connect} = require('socket.io-client');
const {createSignalingServer} = require('../server');
const request=(socket,event,payload={})=>new Promise((resolve,reject)=>socket.timeout(2000).emit(event,payload,(error,answer)=>error?reject(error):resolve(answer)));
async function fixture(t,stateFile) {
  const {server,io}=createSignalingServer({stateFile,initialPeers:'test.example:11010'});const sockets=[];let closed=false;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const f={async client(name,index,identity=randomBytes(32).toString('hex')) {
    const socket=connect('http://127.0.0.1:'+server.address().port,{transports:['websocket'],reconnection:false});sockets.push(socket);
    await new Promise(resolve=>socket.once('connect',resolve));
    const joined=await request(socket,'join-server',{userName:name,identity,virtualIp:'10.144.90.'+index,easytierPeers:['tcp://test.example:11010']});
    return {socket,joined,identity};
  },async close(){if(closed)return;closed=true;sockets.forEach(socket=>socket.disconnect());await new Promise(resolve=>io.close(resolve));}};
  t.after(f.close);return f;
}
test('server statistics track membership and preserve creation dates, initializing missing legacy dates once',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-stats-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'state.json'),before=Date.now(),f=await fixture(t,file),host=await f.client('Host',1);
  const initial=host.joined.serverStats;
  assert.equal(initial.users,1);assert.equal(initial.maxUsers,100);assert.equal(initial.channels,1);
  assert.ok(initial.createdAt>=before&&initial.createdAt<=Date.now());assert.ok(initial.serverTime>=initial.createdAt);
  const member=await f.client('Member',2);
  assert.equal(member.joined.serverStats.users,2);
  await request(host.socket,'create-channel',{name:'Other'});
  let stats=(await request(host.socket,'switch-channel',{channelId:'main'})).serverStats;
  assert.equal(stats.channels,2);assert.ok(stats.uptimeMs>=initial.uptimeMs);
  await request(member.socket,'leave-server');stats=(await request(host.socket,'switch-channel',{channelId:'main'})).serverStats;
  assert.equal(stats.users,1,'offline historical profiles do not count against the current user limit');
  await f.close();const g=await fixture(t,file),returning=await g.client('Host',1,host.identity);
  assert.equal(returning.joined.serverStats.createdAt,initial.createdAt);assert.equal(returning.joined.serverStats.channels,2);
  await g.close();const legacy=JSON.parse(fs.readFileSync(file,'utf8'));delete legacy.createdAt;fs.writeFileSync(file,JSON.stringify(legacy));
  const migrationStart=Date.now(),h=await fixture(t,file),old=await h.client('Host',1,host.identity);
  const migrated=old.joined.serverStats.createdAt;
  assert.ok(migrated>=migrationStart&&migrated<=Date.now(),'missing creation date starts at the current startup');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).createdAt,migrated,'migration persists the generated date');
  await h.close();const next=await fixture(t,file),again=await next.client('Host',1,host.identity);
  assert.equal(again.joined.serverStats.createdAt,migrated,'later restarts do not reset the migrated date');
});
