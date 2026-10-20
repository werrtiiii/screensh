export function createChatVideos({getContext,getGeneration,getSocket,requestServer,readChatImage,saveChatImage,cache}) {
  const jobs=new Map();
  async function source(id){const result=await requestServer('chat-video',{id});return new URL(result.path,getSocket().io.uri).href;}
  function stop(video){video.pause();video.removeAttribute('src');video.load();}
  function poster(url,id){return new Promise((resolve,reject)=>{
    const video=document.createElement('video');video.crossOrigin='anonymous';video.preload='metadata';video.muted=true;video.playsInline=true;let finished=false;
    const finish=(error,data)=>{if(finished)return;finished=true;clearTimeout(timer);jobs.delete(id);video.onloadedmetadata=video.onloadeddata=video.onseeked=video.onerror=null;stop(video);error?reject(error):resolve(data);};
    const timer=setTimeout(()=>finish(Error('封面加载超时')),20000);jobs.set(id,()=>finish(Error('预览已取消')));
    const capture=()=>{if(video.readyState<2||!video.videoWidth)return;try{const canvas=document.createElement('canvas'),scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);finish(null,canvas.toDataURL('image/webp',.8));}catch(error){finish(error);}};
    video.onloadedmetadata=()=>{if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(.1,video.duration/2);};
    video.onloadeddata=video.onseeked=capture;video.onerror=()=>finish(Error('暂时无法生成视频封面'));video.src=url;
  });}
  function preview(message){
    const button=document.createElement('button');button.type='button';button.className='chat-video-preview';button.dataset.messageId=message.id;button.setAttribute('aria-label','播放 '+message.file.name);
    const image=document.createElement('img');image.alt='视频封面';image.className='hidden';
    const play=document.createElement('span');play.className='chat-video-play';play.textContent='▶';play.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='chat-video-label';label.textContent='MP4';button.append(image,play,label);button.onclick=()=>void open(message);return button;
  }
  async function load(button){
    const context=getContext(),generation=getGeneration(),id=button.dataset.messageId;if(!context)return;
    const valid=()=>generation===getGeneration()&&button.isConnected;
    try{let data=await readChatImage(context.serverId,id).catch(()=>null);
      if(!valid())return;if(!data){const url=await source(id);if(!valid())return;data=await poster(url,id);if(!valid())return;await cache(saveChatImage(context.serverId,id,data));}
      if(!valid())return;const image=button.querySelector('img');image.src=data;image.classList.remove('hidden');
    }catch{if(valid())button.querySelector('.chat-video-label').textContent='MP4 · 点击播放';}
  }
  function close(dialog){const video=dialog.querySelector('video');if(video)stop(video);dialog.remove();}
  async function open(message){
    document.querySelectorAll('.chat-video-dialog').forEach(close);
    const generation=getGeneration(),dialog=document.createElement('div');dialog.className='modal chat-video-dialog';dialog.dataset.messageId=message.id;
    dialog.innerHTML='<div class="modal-content" role="dialog" aria-modal="true" aria-label="视频播放"><div class="modal-header"><h2></h2><button type="button" class="btn-close" aria-label="关闭">×</button></div><video controls playsinline preload="metadata"></video><p class="chat-video-status" role="status">加载中…</p></div>';
    dialog.querySelector('h2').textContent=message.file.name;dialog.querySelector('button').onclick=()=>close(dialog);dialog.onclick=event=>{if(event.target===dialog)close(dialog);};document.body.append(dialog);
    const video=dialog.querySelector('video'),status=dialog.querySelector('.chat-video-status');
    video.onloadeddata=video.onplaying=()=>{status.textContent='';};video.onerror=()=>{status.textContent='视频已过期、连接失败或编码不支持，可关闭后重试，或下载文件播放。';};
    try{const url=await source(message.id);if(generation!==getGeneration()||!dialog.isConnected)return;video.src=url;void video.play().catch(()=>{if(!video.error&&dialog.isConnected)status.textContent='点击播放按钮开始播放';});}
    catch(error){if(dialog.isConnected)status.textContent=error.message;}
  }
  function remove(id){jobs.get(id)?.();for(const dialog of document.querySelectorAll('.chat-video-dialog'))if(dialog.dataset.messageId===id)close(dialog);}
  function clear(){for(const cancel of [...jobs.values()])cancel();document.querySelectorAll('.chat-video-dialog').forEach(close);}
  return {preview,load,remove,clear};
}
