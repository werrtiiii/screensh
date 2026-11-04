const {test}=require('node:test'),assert=require('node:assert/strict'),dgram=require('node:dgram'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events');
const {createMediaUdpPacer}=require('../main/media-udp-pacer.cjs');

test('native audio timing restores original policy and refuses a reused process identity',async t=>{
  const exe=path.resolve(__dirname,'../res/screensh-media-udp.exe');if(process.platform!=='win32'||!fs.existsSync(exe)){t.skip('Windows media helper not built');return;}
  const run=(mode,token)=>{const result=require('node:child_process').spawnSync(exe,['--audio-policy',mode,token],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const saved=run('apply',String(process.pid));if(!saved.applied){t.skip('Windows power policy API unavailable: '+saved.error);return;}
  const token=`${saved.pid}:${saved.created}:${saved.control}:${saved.state}`;t.after(()=>run('restore',token));
  assert.equal(run('restore',`${saved.pid}:0:${saved.control}:${saved.state}`).applied,false,'PID alone cannot authorize restoration after reuse');
  assert.equal(run('restore',token).applied,true);
  const again=run('apply',String(process.pid));assert.equal(again.control,saved.control);assert.equal(again.state,saved.state);
});
for(const mode of [undefined,'receive'])test(`native ${mode||'legacy'} pacing preserves an encrypted-RTP-sized burst, control feedback and releases its port`,async t=>{
  const exe=path.resolve(__dirname,'../res/screensh-media-udp.exe');if(process.platform!=='win32'||!fs.existsSync(exe)){t.skip('Windows media helper not built');return;}
  const backend=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024,sendBufferSize:2*1024*1024}),client=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024});let pacer;
  t.after(async()=>{await pacer?.stop();backend.close();client.close();});backend.bind(0,mode?'127.0.0.1':'127.0.0.2');await once(backend,'listening');client.bind(0,'127.0.0.1');await once(client,'listening');
  pacer=createMediaUdpPacer({port:0,targetPort:backend.address().port,mode,exe});const port=await pacer.start(),count=600,seen=[];let control=false;
  backend.on('message',(_request,remote)=>{for(let i=0;i<count;i++){const packet=Buffer.alloc(1200);packet[0]=0x80;packet[1]=96;packet.writeUInt16BE(i,2);backend.send(packet,remote.port,remote.address);}backend.send(Buffer.from('control'),remote.port,remote.address);});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`paced packets: ${seen.length}/${count}`)),7000);client.on('message',packet=>{if(packet.toString()==='control')control=true;else seen.push(packet.readUInt16BE(2));if(control&&seen.length===count){clearTimeout(timer);resolve();}});client.send(Buffer.from('burst'),port,'127.0.0.1');});
  assert.deepEqual(seen,Array.from({length:count},(_,i)=>i));assert.equal(control,true);await pacer.stop();const rebound=dgram.createSocket('udp4');rebound.bind(port,'127.0.0.1');await once(rebound,'listening');rebound.close();
});

test('publisher pacing protects EasyTier UDP input while keeping control traffic bidirectional',async t=>{
  const exe=path.resolve(__dirname,'../res/screensh-media-udp.exe');if(process.platform!=='win32'||!fs.existsSync(exe)){t.skip('Windows media helper not built');return;}
  const backend=dgram.createSocket('udp4'),client=dgram.createSocket({type:'udp4',sendBufferSize:2*1024*1024});let pacer;
  t.after(async()=>{await pacer?.stop();backend.close();client.close();});backend.bind(0,'127.0.0.1');await once(backend,'listening');client.bind(0,'127.0.0.1');await once(client,'listening');
  pacer=createMediaUdpPacer({port:0,targetPort:backend.address().port,mode:'publish',exe});const port=await pacer.start(),count=600,seen=[];let feedback=false;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`publisher packets: ${seen.length}/${count}`)),7000);
    const done=()=>{if(feedback&&seen.length===count){clearTimeout(timer);resolve();}};
    backend.on('message',(packet,remote)=>{if(packet.toString()==='control')backend.send(Buffer.from('feedback'),remote.port,remote.address);else seen.push(packet.readUInt16BE(2));done();});
    client.on('message',packet=>{if(packet.toString()==='feedback')feedback=true;done();});
    for(let i=0;i<count;i++){const packet=Buffer.alloc(1200);packet[0]=0x80;packet[1]=96;packet.writeUInt16BE(i,2);client.send(packet,port,'127.0.0.1');}
    client.send(Buffer.from('control'),port,'127.0.0.1');
  });
  assert.deepEqual(seen,Array.from({length:count},(_,i)=>i));assert.equal(feedback,true);
});

test('NACK duplicates do not fill the pacing queue, and retransmission remains possible after sending',async t=>{
  const exe=path.resolve(__dirname,'../res/screensh-media-udp.exe');if(process.platform!=='win32'||!fs.existsSync(exe)){t.skip('Windows media helper not built');return;}
  const backend=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024}),client=dgram.createSocket({type:'udp4',sendBufferSize:2*1024*1024});let pacer;
  t.after(async()=>{await pacer?.stop();backend.close();client.close();});backend.bind(0,'127.0.0.1');await once(backend,'listening');client.bind(0,'127.0.0.1');await once(client,'listening');
  pacer=createMediaUdpPacer({port:0,targetPort:backend.address().port,mode:'publish',exe});const port=await pacer.start(),seen=new Set();let firstPacketCount=0;
  backend.on('message',bytes=>{const sequence=bytes.readUInt16BE(2);seen.add(sequence);if(sequence===0)firstPacketCount++;});
  const send=i=>{const packet=Buffer.alloc(1200);packet[0]=0x80;packet[1]=96;packet.writeUInt16BE(i,2);client.send(packet,port,'127.0.0.1');};
  for(let round=0;round<3;round++){for(let i=0;i<1200;i++)send(i);await new Promise(resolve=>setTimeout(resolve,10));}
  const until=Date.now()+5000;while(seen.size<1200||pacer.stats().duplicates===undefined){assert.ok(Date.now()<until,'paced burst and stats complete');await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(pacer.stats().dropped,0);assert.ok(pacer.stats().duplicates>0);assert.equal(seen.size,1200);
  const before=firstPacketCount;send(0);const retryUntil=Date.now()+2000;while(firstPacketCount===before){assert.ok(Date.now()<retryUntil,'a packet already sent can be retransmitted');await new Promise(resolve=>setTimeout(resolve,10));}
});
