const {execFile}=require('node:child_process');
function createAudioTiming({exe,getProcesses,platform=process.platform,execute=execFile}){
  let active=false,timer,queue=Promise.resolve();const originals=new Map();
  const serial=work=>{const result=queue.then(work);queue=result.catch(()=>{});return result;};
  const run=args=>new Promise((resolve,reject)=>execute(exe,['--audio-policy',...args],{windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:128*1024},(error,stdout)=>{if(error)return reject(error);try{resolve(stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)));}catch(error){reject(error);}}));
  async function refresh(){
    if(!active||platform!=='win32')return;
    const current=new Set(getProcesses().map(row=>row.pid).filter(pid=>Number.isInteger(pid)&&pid>0));
    for(const pid of originals.keys())if(!current.has(pid))originals.delete(pid);
    const pending=[...current].filter(pid=>!originals.has(pid)).slice(0,128);if(!pending.length)return;
    for(const record of await run(['apply',...pending.map(String)]))if(record.applied&&current.has(record.pid))originals.set(record.pid,record);
  }
  return {
    setActive(value){
      if(typeof value!=='boolean')throw Error('无效语音计时状态');active=value;clearInterval(timer);
      if(active){timer=setInterval(()=>{void serial(refresh).catch(error=>console.warn('[Audio timing]',error.message));},5000);timer.unref?.();return serial(refresh);}
      return serial(async()=>{if(!originals.size)return;const saved=[...originals.values()];await run(['restore',...saved.map(row=>`${row.pid}:${row.created}:${row.control}:${row.state}`)]);originals.clear();});
    },
  };
}
module.exports={createAudioTiming};
