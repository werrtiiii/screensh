const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
function fixture(){
  const connection=new EventEmitter();connection.connected=true;
  connection.timeout=()=>({emit:(event,payload,ack)=>{connection.ack=ack;}});
  const code=fs.readFileSync(require.resolve('../renderer/signaling.js'),'utf8');
  const context={socket:connection,state:{leaving:false},Error};vm.createContext(context);
  vm.runInContext(code.slice(code.indexOf('export function requestServer'),code.indexOf('export function applyServerState')).replace('export ',''),context);
  return {connection,context,request:context.requestServer};
}
test('leaving cancels an outstanding request immediately and never labels disconnect as timeout',async()=>{
  const f=fixture(),pending=f.request('set-voice-state');f.context.state.leaving=true;f.connection.connected=false;
  f.connection.emit('disconnect','io client disconnect');f.connection.ack(Error('socket disconnected'));
  await assert.rejects(pending,error=>error.code==='REQUEST_CANCELLED' && !error.message.includes('超时'));
  assert.equal(f.connection.listenerCount('disconnect'),0);
});
test('unexpected network disconnect differs from a genuine connected-server timeout',async()=>{
  const f=fixture(),pending=f.request('set-voice-state');f.connection.connected=false;f.connection.emit('disconnect','transport close');
  await assert.rejects(pending,error=>error.code==='CONNECTION_LOST');
  const g=fixture(),timeout=g.request('create-channel');g.connection.ack(Error('timed out'));
  await assert.rejects(timeout,error=>error.code==='SERVER_TIMEOUT' && !error.message.includes('新版'));
  assert.equal(g.connection.listenerCount('disconnect'),0);
});
test('successful responses and server validation errors retain their original result',async()=>{
  const f=fixture(),success=f.request('server-info');f.connection.ack(null,{ok:true,serverName:'Server'});
  assert.equal((await success).serverName,'Server');assert.equal(f.connection.listenerCount('disconnect'),0);
  const rejected=f.request('create-channel');f.connection.ack(null,{ok:false,message:'只有房主和管理员可以创建频道'});
  await assert.rejects(rejected,/只有房主和管理员/);assert.equal(f.connection.listenerCount('disconnect'),0);
});
