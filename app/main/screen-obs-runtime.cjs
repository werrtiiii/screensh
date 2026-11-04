const {fork,execFile}=require('node:child_process');
const path=require('node:path');
class ScreenObsRuntime{
  constructor(dataPath,onFailure=()=>{},publishUrl='http://127.0.0.1:8889/live/whip',_isolated=true,options={}){
    Object.assign(this,{dataPath,onFailure,publishUrl});this.options={stopTimeoutMs:3000,startTimeoutMs:25000,sourceTimeoutMs:15000,idleMs:30000,...options};this.pending=new Map();this.sequence=0;this.streaming=false;
  }
  ensureWorker(){
    clearTimeout(this.idleTimer);if(this.worker)return this.worker;
    const worker=this.worker=(this.options.forkProcess||fork)(this.options.workerFile||path.join(__dirname,'screen-obs-worker.cjs'),[this.dataPath],{execPath:process.execPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    worker.stdout?.on('data',bytes=>{if(process.env.SCREENSH_OBS_DEBUG==='1')console.log('[Screen OBS]',bytes.toString());});worker.stderr?.on('data',bytes=>console.error('[Screen OBS]',bytes.toString()));
    worker.on('message',message=>{
      if(message.event==='failure'){if(this.worker===worker&&!this.stopping)this.onFailure(message.error);return;}
      const pending=this.pending.get(message.id);if(!pending||pending.worker!==worker)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);message.error?pending.reject(Error(message.error)):pending.resolve(message.result);
    });
    const exited=error=>{
      if(this.worker===worker){this.worker=null;const active=this.streaming;this.streaming=false;if(active&&!this.stopping)this.onFailure(error.message);}
      for(const [id,pending]of this.pending)if(pending.worker===worker){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(error);}
    };
    worker.once('error',error=>exited(Error('无法启动屏幕采集进程：'+error.message)));worker.once('exit',()=>exited(Error('屏幕采集进程已退出或已重置')));return worker;
  }
  request(action,payload={},timeoutMs=this.options.startTimeoutMs){
    const worker=this.ensureWorker();return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(async()=>{if(!this.pending.has(id))return;this.pending.delete(id);await this.terminate(worker);reject(Error('屏幕采集操作超时，已重置采集进程，请重试'));},timeoutMs);
      this.pending.set(id,{worker,timer,resolve,reject});
      worker.send({id,action,...payload},error=>{if(!error)return;const pending=this.pending.get(id);if(!pending)return;clearTimeout(timer);this.pending.delete(id);reject(Error('屏幕采集进程连接失败'));});
    });
  }
  async terminate(worker){
    if(!worker)return;if(worker.screenTermination)return worker.screenTermination;
    worker.screenTermination=(async()=>{
      if(this.worker===worker){this.worker=null;this.streaming=false;}clearTimeout(this.idleTimer);
      if(worker.exitCode===null&&!worker.signalCode){
        if(process.platform==='win32')await new Promise(resolve=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,timeout:2000},()=>resolve()));
        else worker.kill('SIGKILL');
        if(worker.exitCode===null&&!worker.signalCode)worker.kill('SIGKILL');
      }
      for(const [id,pending]of this.pending)if(pending.worker===worker){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(Error('屏幕采集进程已重置'));}
    })();return worker.screenTermination;
  }
  async sources(displays){if(this.shuttingDown)await this.shuttingDown;if(this.stopping)await this.stopping;const result=await this.request('sources',{displays},this.options.sourceTimeoutMs);this.scheduleIdle();return result;}
  async start(config){
    if(this.shuttingDown)await this.shuttingDown;if(this.stopping)await this.stopping;if(this.streaming||this.starting)throw Error('OBS 正在共享');clearTimeout(this.idleTimer);this.starting=true;
    try{const result=await this.request('start',{config,publishUrl:this.publishUrl});if(this.stopping)throw Error('共享启动已取消');this.streaming=true;return result;}
    finally{this.starting=false;}
  }
  stopAndWait(){
    if(this.stopping)return this.stopping;this.streaming=false;clearTimeout(this.idleTimer);
    this.stopping=(async()=>{if(!this.worker)return;try{await this.request('stop',{},this.options.stopTimeoutMs);}catch(error){if(this.worker)await this.terminate(this.worker);if(process.env.SCREENSH_OBS_DEBUG==='1')console.warn('[Screen OBS cleanup]',error.message);}})().finally(()=>{this.stopping=null;this.scheduleIdle();});return this.stopping;
  }
  stop(){return this.stopAndWait();}
  scheduleIdle(){clearTimeout(this.idleTimer);if(!this.worker||this.streaming||this.starting||this.stopping)return;this.idleTimer=setTimeout(()=>void this.shutdown().catch(error=>this.onFailure(error.message)),this.options.idleMs);this.idleTimer.unref?.();}
  shutdown(){if(this.shuttingDown)return this.shuttingDown;const worker=this.worker;clearTimeout(this.idleTimer);this.shuttingDown=(async()=>{await this.stopAndWait();clearTimeout(this.idleTimer);await this.terminate(worker);})().finally(()=>{this.shuttingDown=null;});return this.shuttingDown;}
}
module.exports={ScreenObsRuntime};
