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
test('native pacing preserves an encrypted-RTP-sized burst, control feedback and releases its port',async t=>{
  const exe=path.resolve(__dirname,'../res/screensh-media-udp.exe');if(process.platform!=='win32'||!fs.existsSync(exe)){t.skip('Windows media helper not built');return;}
  const backend=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024,sendBufferSize:2*1024*1024}),client=dgram.createSocket({type:'udp4',recvBufferSize:2*1024*1024});let pacer;
  t.after(async()=>{await pacer?.stop();backend.close();client.close();});backend.bind(0,'127.0.0.2');await once(backend,'listening');client.bind(0,'127.0.0.1');await once(client,'listening');
  pacer=createMediaUdpPacer({port:0,targetPort:backend.address().port,exe});const port=await pacer.start(),count=600,seen=[];let control=false;
  backend.on('message',(_request,remote)=>{for(let i=0;i<count;i++){const packet=Buffer.alloc(1200);packet[0]=0x80;packet[1]=96;packet.writeUInt16BE(i,2);backend.send(packet,remote.port,remote.address);}backend.send(Buffer.from('control'),remote.port,remote.address);});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`paced packets: ${seen.length}/${count}`)),7000);client.on('message',packet=>{if(packet.toString()==='control')control=true;else seen.push(packet.readUInt16BE(2));if(control&&seen.length===count){clearTimeout(timer);resolve();}});client.send(Buffer.from('burst'),port,'127.0.0.1');});
  assert.deepEqual(seen,Array.from({length:count},(_,i)=>i));assert.equal(control,true);await pacer.stop();const rebound=dgram.createSocket('udp4');rebound.bind(port,'127.0.0.1');await once(rebound,'listening');rebound.close();
});
