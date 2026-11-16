const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createUpdateWindow}=require('../main/update-window.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const handlers=new Map(),windows=[],installs=[],errors=[];let finishes=[],cancelCalls=0,cancelDrain=Promise.resolve();
  class Window extends EventEmitter{
    constructor(){super();this.webContents=new EventEmitter();this.webContents.send=()=>{};windows.push(this);}
    isDestroyed(){return this.destroyed===true;}show(){}destroy(){this.destroyed=true;this.emit('closed');}loadFile(){return Promise.resolve();}
  }
  const updates={get:()=>({}),prepareUpdate:()=>new Promise(resolve=>finishes.push(resolve)),cancel:()=>{cancelCalls++;return cancelDrain;},reportFailure:error=>errors.push(error)};
  const controller=createUpdateWindow({BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},updates,enter(){},quit(){},install:async window=>installs.push(window)});
  return {controller,windows,handlers,finishes,installs,errors,get cancelCalls(){return cancelCalls;},setDrain(value){cancelDrain=value;}};
}
test('closing a manual updater cancels and never installs or reports a late failure',async()=>{
  const f=fixture();f.controller.open(true);f.windows[0].webContents.emit('did-finish-load');await tick();
  assert.equal(f.handlers.get('updater-close')({sender:f.windows[0].webContents}),true);assert.equal(f.cancelCalls,1);
  f.finishes[0]({install:true});await tick();assert.equal(f.installs.length,0);assert.equal(f.errors.length,0);
});
test('a reopened window waits for cancellation drain and ignores the old completion',async()=>{
  const f=fixture();let drain;f.setDrain(new Promise(resolve=>{drain=resolve;}));
  f.controller.open(true);f.windows[0].webContents.emit('did-finish-load');await tick();f.handlers.get('updater-close')({sender:f.windows[0].webContents});
  f.controller.open(true);f.windows[1].webContents.emit('did-finish-load');await tick();assert.equal(f.finishes.length,1);
  f.finishes[0]({install:true});drain();await tick();assert.equal(f.installs.length,0);assert.equal(f.finishes.length,2);
  f.finishes[1]({install:true});await tick();assert.deepEqual(f.installs,[f.windows[1]]);
});
test('once installer handoff begins, closing is blocked until it finishes',async()=>{
  let finishInstall,quitting=false;
  // The exposed install promise lasts across a real independent-window handoff.
  const handlers=new Map(),windows=[];class Window extends EventEmitter{constructor(){super();this.webContents=new EventEmitter();this.webContents.send=()=>{};windows.push(this);}show(){}isDestroyed(){return false;}loadFile(){return Promise.resolve();}}
  const controller=createUpdateWindow({BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},updates:{get:()=>({}),prepareUpdate:async()=>({install:true}),cancel:()=>assert.fail('handoff must not be cancelled'),reportFailure:()=>assert.fail('handoff failed')},enter(){},quit(){},canQuit:()=>quitting,install:()=>new Promise(resolve=>{finishInstall=resolve;})});
  controller.open(true);windows[0].webContents.emit('did-finish-load');await tick();assert.equal(handlers.get('updater-close')({sender:windows[0].webContents}),false);
  let blocked=false;windows[0].emit('close',{preventDefault:()=>{blocked=true;}});assert.equal(blocked,true);
  quitting=true;blocked=false;windows[0].emit('close',{preventDefault:()=>{blocked=true;}});assert.equal(blocked,false,'installer handoff must permit the parent application to quit');
  finishInstall();await tick();
});
