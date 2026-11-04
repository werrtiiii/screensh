const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
  const nodes=new Map(),events=new Map(),requests=[],notices=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,textContent:'',dataset:{},classList:{toggle(){}},addEventListener(event,fn){this[event]=fn;}});return nodes.get(id);};
  const state={roomId:'first',videoRelay:{version:2,enabled:true,configured:true,ready:true},serverUsers:[{socketId:'one',role:'host'}]};
  const context=vm.createContext({state,socket:{id:'one'},document:{querySelector:node,addEventListener:(event,fn)=>events.set(event,fn)},localStorage:{getItem:()=>null,setItem(){}},toast:message=>notices.push(message)});
  const code=fs.readFileSync(require.resolve('../renderer/relay-settings.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function');
  vm.runInContext(code,context);context.initRelaySettings(event=>{const gate=deferred();requests.push({event,...gate});return gate.promise;});
  function switchServer(){context.socket={id:'two'};state.roomId='second';state.serverUsers=[{socketId:'two',role:'host'}];state.videoRelay={version:2,enabled:false,configured:false,ready:false};events.get('video-relay-state')();}
  async function load(){const pending=node('#btnServerSettings').click();requests.at(-1).resolve({network:{name:'test',secret:'old-secret',relayHost:'10.0.0.1',relayPort:8889}});await pending;}
  return {node,state,requests,notices,switchServer,load};
}
test('a previous server cannot restore its settings or secret after switching servers',async()=>{
  const f=fixture(),pending=f.node('#btnServerSettings').click();f.switchServer();
  f.requests[0].resolve({network:{name:'stale',secret:'stale-secret',relayHost:'10.0.0.1',relayPort:8889}});await pending;
  assert.equal(f.node('#serverNetworkSecret').value,'');assert.equal(f.node('#useServerRelayCheckbox').disabled,true);
});
for(const action of ['save','toggle'])test(`a stale ${action} response cannot overwrite the next server or release its pending operation`,async()=>{
  const f=fixture();await f.load();
  const pending=action==='save'?f.node('#serverNetworkForm').onsubmit({preventDefault(){}}):f.node('#serverVideoRelayEnabled').onchange();
  const stale=f.requests.at(-1);f.switchServer();assert.equal(f.node('#serverNetworkSecret').value,'');
  const current=f.node('#btnServerSettings').click();assert.equal(f.node('#btnSaveServerNetwork').disabled,true);
  stale.resolve({videoRelay:{version:2,enabled:true,ready:true}});await pending;
  assert.equal(f.state.videoRelay.enabled,false);assert.equal(f.node('#btnSaveServerNetwork').disabled,true);assert.equal(f.notices.length,0);
  f.requests.at(-1).reject(Error('current request failed'));await current;
  assert.equal(f.node('#serverNetworkError').textContent,'current request failed');assert.equal(f.node('#btnSaveServerNetwork').disabled,false);
});
