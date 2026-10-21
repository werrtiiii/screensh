const {test}=require('node:test'),assert=require('node:assert/strict');
test('no TUN ICE exposes local UDP ports, maps only the intended member and releases late-created scopes',async()=>{
  const {createMediaTunnel}=await import('../renderer/media-tunnel.mjs');let closed=0,mapped=0,exposed=0;
  const api={openTunnelScope:async()=>({id:'scope'}),closeTunnelScope:async()=>{closed++;},exposeTunnelPort:async(_id,host,port)=>{assert.equal(host,'192.168.1.2');assert.equal(port,12000);exposed++;return {port:23000};},forwardTunnelPort:async(_id,protocol,port)=>{assert.equal(protocol,'udp');assert.equal(port,24000);mapped++;return {host:'192.168.1.2',port:25000};}};
  const tunnel=createMediaTunnel('10.144.1.2',true,api),local={candidate:'candidate:1 1 udp 100 192.168.1.2 12000 typ host',sdpMid:'0',sdpMLineIndex:0};
  assert.equal((await tunnel.localCandidate(local,'10.144.1.1')).candidate.split(' ')[4],'10.144.1.1');
  assert.equal(await tunnel.remoteCandidate({candidate:'candidate:1 1 udp 100 10.144.1.3 24000 typ host'}),null);
  const remote=await tunnel.remoteCandidate({candidate:'candidate:1 1 udp 100 10.144.1.2 24000 typ host',sdpMid:'0'});assert.equal(remote.candidate.split(' ')[4],'192.168.1.2');assert.equal(mapped,1);assert.equal(exposed,1);
  const description=Object.create({type:'offer',sdp:'v=0\r\na='+local.candidate+'\r\n'});assert.equal((await tunnel.localDescription(description,'10.144.1.1')).type,'offer');
  tunnel.close();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);
  const late=createMediaTunnel('10.144.1.2',true,api);late.close();await new Promise(resolve=>setImmediate(resolve));assert.ok(closed>=2);
});
test('default TUN mode does not open proxy scopes and preserves existing virtual-address candidates',async()=>{
  const {createMediaTunnel}=await import('../renderer/media-tunnel.mjs');const tunnel=createMediaTunnel('10.144.1.2',false,{});
  const candidate={candidate:'candidate:1 1 udp 100 10.144.1.2 12000 typ host'};assert.deepEqual(await tunnel.remoteCandidate(candidate),candidate);assert.deepEqual(await tunnel.http(8889),{host:'10.144.1.2',port:8889});tunnel.close();
});
