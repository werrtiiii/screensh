const path=require('node:path');
const {ManagedProcess}=require('./managed-process');
// Keep pacing out of Electron's event loop: Windows JavaScript timers can
// coalesce into multi-millisecond bursts under load.
function createMediaUdpPacer({port,targetPort=port,exe=path.resolve(__dirname,'../res/screensh-media-udp.exe'),onFailure=()=>{}}={}){
  const runtime=new ManagedProcess('Media UDP',onFailure);let closed=false;
  function messages(){return (runtime.output||'').split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}
  return {
    async start(){if(closed)throw Error('媒体转发器已关闭');await runtime.start(exe,[String(port),String(targetPort)],{ready:log=>/"type":"ready"/.test(log),timeout:5000});const ready=messages().find(message=>message.type==='ready');if(!ready||closed){await runtime.stop();throw Error('媒体转发器未就绪');}return ready.port;},
    stats(){return messages().filter(message=>message.type==='stats').at(-1)||{};},
    async stop(){closed=true;await runtime.stop();},
  };
}
module.exports={createMediaUdpPacer};
