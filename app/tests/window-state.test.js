const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createWindowState}=require('../main/window-state.cjs');

function fixture(t,workArea={x:0,y:0,width:1920,height:1040}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-window-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'window-state.json'),screen={getPrimaryDisplay:()=>({workArea}),getDisplayMatching:()=>({workArea})};
  return {file,store:createWindowState({file,screen})};
}
test('window size and position survive closing and reopening',t=>{
  const {file,store}=fixture(t),bounds={x:120,y:90,width:1100,height:720};
  const win=Object.assign(new EventEmitter(),{isMaximized:()=>false,getNormalBounds:()=>bounds});
  store.track(win);win.emit('close');
  assert.deepEqual(store.read(),{bounds,maximized:false});
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{bounds,maximized:false});
});
test('a minimized maximized window retains its normal bounds and maximized state',t=>{
  const {store}=fixture(t),bounds={x:70,y:50,width:1200,height:800};
  const win=Object.assign(new EventEmitter(),{isMaximized:()=>false,getNormalBounds:()=>bounds});
  store.track(win);win.emit('maximize');win.emit('minimize');win.emit('close');
  assert.deepEqual(store.read(),{bounds,maximized:true});
  win.emit('unmaximize');win.emit('close');assert.equal(store.read().maximized,false);
});
test('disconnected displays and oversized bounds are brought back into the current work area',t=>{
  const area={x:-1366,y:0,width:1366,height:728},{file,store}=fixture(t,area);
  fs.writeFileSync(file,JSON.stringify({bounds:{x:3500,y:2200,width:1800,height:1100},maximized:true}));
  assert.deepEqual(store.read(),{bounds:{x:-1366,y:0,width:1366,height:728},maximized:true});
});
test('missing, malformed and invalid settings fall back to a usable default',t=>{
  const {file,store}=fixture(t),expected={bounds:{x:360,y:120,width:1200,height:800},maximized:false};
  assert.deepEqual(store.read(),expected);
  for(const value of ['{', 'null',JSON.stringify({bounds:{x:1,y:2,width:-20,height:'large'},maximized:true}),JSON.stringify({bounds:{x:1e20,y:0,width:1200,height:800},maximized:true})]){
    fs.writeFileSync(file,value);assert.deepEqual(store.read(),expected);
  }
});
