const {ObsWebSocket}=require('./obs-websocket.cjs');
const {randomUUID}=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class ExternalObs {
  constructor({getCredentials,onEnded=()=>{},clientFactory=options=>new ObsWebSocket(options)}){Object.assign(this,{getCredentials,onEnded,clientFactory});this.recoveries=new Map();}
  get active(){return !!this.entry;}
  async inspect(credentials=this.getCredentials()){
    if(this.entry)throw Error('请先停止共享再检查 OBS 连接');
    const client=this.clientFactory(credentials);try{
      await client.connect();await this.restoreRecovery(client);
      const [version,status,scene]=await Promise.all([client.call('GetVersion'),client.call('GetStreamStatus'),client.call('GetCurrentProgramScene')]);
      if(!version.availableRequests?.includes('StartStream')||!version.availableRequests?.includes('SetStreamServiceSettings'))throw Error('OBS 缺少推流控制接口，请更新 OBS');
      let thumbnail=null;if(scene.currentProgramSceneName){try{const image=await client.call('GetSourceScreenshot',{sourceName:scene.currentProgramSceneName,imageFormat:'png',imageWidth:640});if(typeof image.imageData==='string'&&image.imageData.startsWith('data:image/png;base64,')&&image.imageData.length<2*1024*1024)thumbnail=image.imageData;}catch{}}
      return {connected:true,version:version.obsVersion,scene:scene.currentProgramSceneName||'当前场景',streaming:!!status.outputActive,thumbnail};
    }finally{client.close();}
  }
  async restoreRecovery(client){
    const recovery=this.recoveries.get(client.port);if(!recovery)return;
    const current=await client.call('GetStreamServiceSettings'),status=await client.call('GetStreamStatus');
    if(this.isOurs(current,recovery.url)){
      if(status.outputActive)throw Error('上次 OBS 推流尚未停止，请先在 OBS 中停止推流');
      await client.call('SetStreamServiceSettings',recovery.original);
    }this.recoveries.delete(client.port);
  }
  isOurs(settings,url){return settings.streamServiceType==='whip_custom'&&settings.streamServiceSettings?.server===url;}
  start(url){
    if(this.entry)throw Error('外部 OBS 共享尚未结束');
    const entry=this.entry={id:randomUUID(),url,credentials:this.getCredentials(),cancelled:false,stopping:false};
    entry.start=this.startEntry(entry);return entry.start;
  }
  async startEntry(entry){
    const check=()=>{if(entry.cancelled)throw Error('共享启动已取消');};
    const client=entry.client=this.clientFactory(entry.credentials);await client.connect();check();await this.restoreRecovery(client);check();
    const status=await client.call('GetStreamStatus');check();if(status.outputActive)throw Error('OBS 已在推流，请先在 OBS 中停止现有推流');
    entry.original=await client.call('GetStreamServiceSettings');check();
    const video=await client.call('GetVideoSettings');check();
    entry.changed=true;await client.call('SetStreamServiceSettings',{streamServiceType:'whip_custom',streamServiceSettings:{server:entry.url,bearer_token:''}});check();
    const ended=message=>{if(!entry.started||entry.stopping||this.entry!==entry||entry.reported)return;entry.reported=true;this.onEnded({message,sessionId:entry.id});};
    client.on('disconnected',()=>ended('OBS 连接中断，共享已结束。如 OBS 仍在推流，请在 OBS 中停止。'));
    client.on('event',event=>{if(event?.eventType==='StreamStateChanged'&&event.eventData?.outputState==='OBS_WEBSOCKET_OUTPUT_STOPPED')ended('OBS 已停止推流');});
    entry.attempted=true;await client.call('StartStream');check();entry.started=true;
    return {width:video.outputWidth,height:video.outputHeight,externalObs:true,externalObsSessionId:entry.id};
  }
  stop(){
    const entry=this.entry;if(!entry)return Promise.resolve();if(entry.stop)return entry.stop;
    entry.cancelled=true;entry.stopping=true;
    entry.stop=(async()=>{
      await entry.start.catch(()=>{});let client=entry.client;
      try{
        if(!entry.changed)return;
        if(!client.ready){client.close();client=entry.client=this.clientFactory(entry.credentials);try{await client.connect();}catch{this.recoveries.set(entry.credentials.port,{url:entry.url,original:entry.original});return;}}
        let current=await client.call('GetStreamServiceSettings');if(!this.isOurs(current,entry.url))return;
        let status=await client.call('GetStreamStatus');
        if(entry.attempted&&status.outputActive){await client.call('StopStream');const until=Date.now()+8000;do{status=await client.call('GetStreamStatus');if(!status.outputActive)break;await sleep(150);}while(Date.now()<until);if(status.outputActive)throw Error('OBS 仍在停止推流，请重试');}
        if(!status.outputActive){current=await client.call('GetStreamServiceSettings');if(this.isOurs(current,entry.url))await client.call('SetStreamServiceSettings',entry.original);}
      }finally{client.close();}
    })().then(()=>{if(this.entry===entry)this.entry=null;},error=>{entry.stop=null;throw error;});return entry.stop;
  }
}
module.exports={ExternalObs};
