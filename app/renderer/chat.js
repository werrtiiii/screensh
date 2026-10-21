import {renderChatMarkup,safeChatLink} from './chat-markup.mjs';
import {chatCacheSettings,saveChatCacheSettings,mergeChatCache,readChatCache,readChatImage,saveChatImage,clearChatCache,chatCacheUsage,recallChatMessages} from './chat-cache.mjs';
import {toast} from './toast.js';
import {avatarThumbnail} from './avatar-thumbnail.mjs';
import {readCachedImage,saveCachedImage} from './image-cache.mjs';
import {showContextMenu} from './context-menu.js';
import {chatImageType} from './chat-image-type.mjs';
import {createChatVideos} from './chat-video.mjs';

const sizeLabel=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.ceil(bytes/1024)+' KB';
function confirmClear(text) {
  return new Promise(resolve=>{
    const modal=document.createElement('div');modal.className='modal chat-confirm-dialog';
    modal.innerHTML='<div class="modal-content" role="dialog" aria-modal="true"><div class="modal-header"><h2>清除聊天记录</h2></div><p></p><div class="dialog-actions"><button type="button" class="btn btn-outline" data-cancel>取消</button><button type="button" class="btn btn-danger" data-confirm>确认清除</button></div></div>';
    modal.querySelector('p').textContent=text;
    const finish=answer=>{modal.remove();resolve(answer);};modal.querySelector('[data-cancel]').onclick=()=>finish(false);modal.querySelector('[data-confirm]').onclick=()=>finish(true);
    document.body.append(modal);modal.querySelector('[data-cancel]').focus();
  });
}
export function initChat({state,getSocket,requestServer}) {
  const $=selector=>document.querySelector(selector),panel=$('#serverChat'),list=$('#chatMessages'),input=$('#chatInput'),root=$('#mainContent');
  const topbar=$('#room .room-topbar');
  new ResizeObserver(()=>root.parentElement.style.setProperty('--chat-topbar-height',topbar.getBoundingClientRect().height+'px')).observe(topbar);
  let context=null,connection=null,generation=0,historyRevision=0,epoch=null,loading=false,hasMore=false,localHasMore=false,draft=[],pendingSend=null,cacheFailed=false,settingsDirty=false;
  let selectionQueue=Promise.resolve();
  const messages=new Map(),nodes=new Map(),urls=new Map(),recalled=new Set(),avatars=new Map();
  let activeUpload=null;
  let serverMaxAttachments=1,serverLimit=512,chatHeight=Number(localStorage.getItem('chatPanelHeight'))||0;
  const handle=$('#chatResizeHandle');
  function layout(){
    const inChannel=!!context?.channelId;handle.classList.toggle('hidden',!inChannel);
    if(inChannel){
      const card=$('#userCardsView .user-card'),row=card?.getBoundingClientRect().height||parseFloat(getComputedStyle($('#userCardsView')).getPropertyValue('--card-cover-height'))+80||240;
      const max=Math.max(80,root.clientHeight-row-32),min=Math.min(150,max),height=Math.min(max,Math.max(min,chatHeight||root.clientHeight*.34));
      panel.style.height=height+'px';
    }else{panel.style.height='';}
  }
  new ResizeObserver(()=>{if(context)layout();}).observe(root);
  handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();handle.setPointerCapture(event.pointerId);const start=event.clientY,height=panel.getBoundingClientRect().height;
    const move=e=>{chatHeight=height+start-e.clientY;layout();chatHeight=panel.getBoundingClientRect().height;};
    const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);localStorage.setItem('chatPanelHeight',String(chatHeight));};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',end,{once:true});window.addEventListener('blur',end,{once:true});};
  handle.onkeydown=event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();chatHeight=panel.getBoundingClientRect().height+(event.key==='ArrowUp'?20:-20);layout();localStorage.setItem('chatPanelHeight',String(panel.getBoundingClientRect().height));};
  const cache=promise=>promise.catch(error=>{console.error('Chat cache:',error);if(!cacheFailed){cacheFailed=true;toast('本地聊天记录保存失败，可在设置中清理缓存','error');}});
  const videos=createChatVideos({getContext:()=>context,getGeneration:()=>generation,getSocket,requestServer,readChatImage,saveChatImage,cache});
  function sizeInput(){input.style.height='auto';input.style.height=Math.min(100,Math.max(32,input.scrollHeight))+'px';}
  input.addEventListener('input',sizeInput);
  function status(text){$('#chatStatus').textContent=text;}
  function releaseMedia(id){for(const [key,url] of urls)if(key===id||key.startsWith(id+':')){URL.revokeObjectURL(url);urls.delete(key);}}
  function clearView(){activeUpload?.abort();videos.clear();$('#chatCancelUpload').classList.add('hidden');observer.disconnect();document.querySelector('.chat-image-dialog')?.remove();$('#chatSend').disabled=false;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();messages.clear();nodes.clear();list.replaceChildren();const empty=document.createElement('p');empty.className='chat-empty';empty.textContent='发送第一条消息，开始聊天';list.append(empty);}
  function draftChanged(images=[]){
    for(const image of draft)if(image.preview&&!images.includes(image))URL.revokeObjectURL(image.preview);
    draft=images;const container=$('#chatAttachment');container.classList.toggle('hidden',!images.length);container.replaceChildren();
    for(const image of images){const item=document.createElement('div');item.className='chat-attachment-item';
      if(image.preview){const preview=document.createElement('img');preview.alt='待发送图片';preview.src=image.preview;item.append(preview);}
      const name=document.createElement('span');name.textContent=image.name;name.title=image.name;
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除 '+image.name);remove.onclick=()=>{if(activeUpload?.images.includes(image))activeUpload.abort();draftChanged(draft.filter(current=>current!==image));};
      item.append(name,remove);container.append(item);
    }
  }
  async function paintAvatar(avatar,message){const member=message.authorId&&context?.members?.find(item=>item.memberId===message.authorId||item.profileId===message.authorId),source=member?.avatar||message.avatar;if(!source)return;
    const token=generation,key=context.serverId+':chat-avatar:'+(message.avatar||message.authorId);
    try{if(!avatars.has(key))avatars.set(key,(async()=>{let data=await readCachedImage(key);if(!data){data=source.startsWith('data:')?source:(await requestServer('get-image',{ref:source})).data;data=await avatarThumbnail(data);await saveCachedImage(key,data);}return data;})());
      const data=await avatars.get(key);if(token!==generation||!avatar.isConnected)return;const image=document.createElement('img');image.alt='';image.src=data;avatar.replaceChildren(image);
    }catch{avatars.delete(key);}
  }
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);if(entry.target.classList.contains('chat-video-preview'))void videos.load(entry.target);else void loadImage(entry.target);}}, {root:list,rootMargin:'160px'});
  async function loadImage(image) {
    const token=generation,serverId=context?.serverId,id=image.dataset.messageId,index=image.dataset.attachmentIndex===undefined?undefined:Number(image.dataset.attachmentIndex),key=index===undefined?id:id+':'+index;if(!serverId)return;
    try {
      let data=await readChatImage(serverId,id,index).catch(()=>null);
      if(!data){const result=await requestServer('chat-image',{id,index},getSocket(),180000);data=result.data;if(token!==generation||recalled.has(id))return;await cache(saveChatImage(serverId,id,data,index));}
      if(token!==generation||recalled.has(id)||!image.isConnected)return;
      const split=data.indexOf(','),type=data.slice(5,data.indexOf(';')),bytes=Uint8Array.from(atob(data.slice(split+1)),character=>character.charCodeAt(0));
      const blob=new Blob([bytes],{type});if(token!==generation)return;
      const follow=list.scrollHeight-list.scrollTop-list.clientHeight<50;
      const url=URL.createObjectURL(blob);urls.set(key,url);image.onload=()=>{if(follow)list.scrollTop=list.scrollHeight;};image.src=url;
    }catch(error){if(token===generation){image.alt='图片已过期或暂时无法加载';image.classList.add('chat-image-unavailable');}}
  }
  function imageDialog(image) {
    if(!image.src)return;const modal=document.createElement('div');modal.className='modal chat-image-dialog';modal.dataset.messageId=image.dataset.messageId||image.closest('.chat-message')?.dataset.messageId||'';
    modal.innerHTML='<div class="modal-content"><div class="modal-header"><h2>图片</h2><button type="button" class="btn-close" aria-label="关闭">×</button></div><img alt="聊天图片" /><div class="dialog-actions"><a class="btn btn-outline btn-sm" download>保存图片</a></div></div>';
    modal.querySelector('img').src=image.src;const link=modal.querySelector('a');link.href=image.src;link.download=image.alt||'图片';modal.querySelector('button').onclick=()=>modal.remove();modal.onclick=event=>{if(event.target===modal)modal.remove();};document.body.append(modal);
  }
  function groupMessages(){let previous=null;for(const node of list.querySelectorAll('.chat-message')){const message=messages.get(node.dataset.messageId);node.classList.toggle('chat-message-grouped',!!message?.authorId&&message.authorId===previous?.authorId);previous=message;}}
  function render(newMessages) {
    const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<50,oldHeight=list.scrollHeight,oldFirst=messages.size?Math.min(...[...messages.values()].map(message=>message.sequence)):Infinity;
    for(const message of newMessages)if(!recalled.has(message.id)&&!messages.has(message.id)) {
      messages.set(message.id,message);list.querySelector('.chat-empty')?.remove();
      const node=document.createElement('article');node.className='chat-message';node.dataset.messageId=message.id;
      const avatar=document.createElement('span');avatar.className='chat-message-avatar';avatar.textContent=[...message.name][0]||'?';
      const main=document.createElement('div');main.className='chat-message-main';const heading=document.createElement('div');heading.className='chat-message-heading';
      const name=document.createElement('strong');name.textContent=message.name;const date=new Date(message.time),time=document.createElement('time');const day=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'),clock=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});time.textContent=day+' '+clock;time.dateTime=date.toISOString();time.title=time.textContent;heading.append(name,time);
      const hoverTime=time.cloneNode(true);hoverTime.textContent=day+'\n'+clock;hoverTime.className='chat-message-hover-time';node.append(hoverTime);
      const content=document.createElement('div');content.className='chat-message-content';content.append(renderChatMarkup(message.text));main.append(heading,content);
      for(const image of content.querySelectorAll('.chat-linked-image'))image.onclick=()=>imageDialog(image);
      const attachments=message.attachments||[...(message.image?[{...message.image,kind:'image'}]:[]),...(message.file?[{...message.file,kind:'file'}]:[])];
      const media=document.createElement('div');media.className='chat-message-media'+(attachments.length>1?' chat-message-media-multiple':'');
      attachments.forEach((attachment,position)=>{const index=message.attachments?.length>1?position:undefined;
        if(attachment.kind==='image'){const image=document.createElement('img');image.className='chat-message-image';image.alt=attachment.name;image.dataset.messageId=message.id;if(index!==undefined)image.dataset.attachmentIndex=index;image.loading='lazy';image.onclick=()=>imageDialog(image);media.append(image);observer.observe(image);}
        else{const item=document.createElement('div');item.className='chat-message-file';if(/\.mp4$/i.test(attachment.name)){const preview=videos.preview({...message,file:attachment,attachmentIndex:index});item.append(preview);observer.observe(preview);}const button=document.createElement('button');button.type='button';button.className='chat-file';button.textContent='↧ '+attachment.name+' · '+sizeLabel(attachment.bytes);button.onclick=async()=>{try{const result=await requestServer('chat-download',{id:message.id,index});const url=new URL(result.path,getSocket().io.uri);await window.electronAPI.downloadChatFile(url.href);}catch(error){toast(error.message,'error');}};item.append(button);media.append(item);}
      });if(attachments.length)main.append(media);
      node.oncontextmenu=event=>{const rank={host:2,admin:1,member:0},target=context?.members?.find(item=>item.memberId===message.authorId),mine=context?.meId===message.authorId,allowed=mine?Date.now()-message.time<=120000:(rank[context?.myRole]??0)>(rank[target?.role||'member']??0);
        showContextMenu(event,allowed?[{label:'撤回消息',run:async()=>{try{onRecall(await requestServer('chat-recall',{id:message.id}));}catch(error){toast(error.message,'error');}}}]:[]);};
      node.append(avatar,main);nodes.set(message.id,node);queueMicrotask(()=>void paintAvatar(avatar,message));
    }
    const ordered=[...messages.values()].sort((a,b)=>a.sequence-b.sequence);
    for(let i=0;i<ordered.length;i++){const node=nodes.get(ordered[i].id);if(list.children[i]!==node)list.insertBefore(node,list.children[i]||null);}
    groupMessages();
    const prepend=newMessages.some(message=>message.sequence<oldFirst);
    if(bottom&&!prepend)list.scrollTop=list.scrollHeight;else if(prepend)list.scrollTop+=list.scrollHeight-oldHeight;
    // Keep routine live sessions bounded; older history can be paged back in.
    if(bottom&&!prepend&&messages.size>200)for(const message of ordered.slice(0,ordered.length-200)){videos.remove(message.id);messages.delete(message.id);nodes.get(message.id)?.remove();nodes.delete(message.id);releaseMedia(message.id);hasMore=true;localHasMore=true;}
    groupMessages();if(bottom&&!prepend)list.scrollTop=list.scrollHeight;
    $('#chatLoadOlder').disabled=loading;$('#chatLoadOlder').classList.toggle('hidden',!hasMore);
  }
  function updateInfo(info) {
    if(!settingsDirty){$('#serverChatDays').value=info.settings.days;$('#serverChatMB').value=info.settings.maxMB;}
    $('#serverChatUsage').textContent=`${info.count} 条消息 · ${sizeLabel(info.bytes)}`;
    serverMaxAttachments=info.maxAttachments||1;serverLimit=info.settings.maxMB;$('#serverChatHelp').dataset.tooltip='0 表示不限制，超过任一上限时删除最早的记录及附件。\n'+$('#serverChatUsage').textContent;
  }
  async function loadHistory(older=false) {
    if(!context||loading)return;const token=generation,revision=historyRevision;loading=true;$('#chatLoadOlder').disabled=true;
    try {
      const before=older&&messages.size?Math.min(...[...messages.values()].map(message=>message.sequence)):undefined;
      if(older){const stored=await readChatCache(context.serverId,before,40);if(token!==generation||revision!==historyRevision)return;localHasMore=stored.messages.length===40;render(stored.messages);}
      const result=await requestServer('chat-history',{before,limit:40});if(token!==generation||revision!==historyRevision)return;
      for(const id of result.recalled||[])removeMessage(id);await cache(recallChatMessages(context.serverId,result.recalled||[]));
      epoch=result.epoch;hasMore=result.hasMore||localHasMore;
      render(result.messages);await cache(mergeChatCache(context.serverId,context.name,epoch,result.messages));updateInfo(result);status('');
    }catch(error){if(token===generation&&revision===historyRevision){status('记录加载失败，点击“更早的消息”重试');hasMore=true;}}
    finally{if(token===generation&&revision===historyRevision){loading=false;$('#chatLoadOlder').disabled=false;$('#chatLoadOlder').classList.toggle('hidden',!hasMore);}}
  }
  const onMessage=event=>{
    if(!context)return;
    epoch=event.epoch;render([event.message]);void cache(mergeChatCache(context.serverId,context.name,epoch,[event.message]));
  };
  const onTrim=info=>{
    if(!context)return;
    epoch=info.epoch;
    void cache(mergeChatCache(context.serverId,context.name,epoch,[]));updateInfo(info);
  };
  const onReset=info=>{historyRevision++;loading=false;epoch=info.epoch;hasMore=localHasMore;$('#chatLoadOlder').disabled=false;$('#chatLoadOlder').classList.toggle('hidden',!hasMore);if(context)void cache(mergeChatCache(context.serverId,context.name,epoch,[]));updateInfo(info);status('');};
  function removeMessage(id){videos.remove(id);recalled.add(id);messages.delete(id);nodes.get(id)?.remove();nodes.delete(id);groupMessages();for(const dialog of document.querySelectorAll('.chat-image-dialog'))if(dialog.dataset.messageId===id)dialog.remove();releaseMedia(id);if(!messages.size&&!list.querySelector('.chat-empty')){const empty=document.createElement('p');empty.className='chat-empty';empty.textContent='发送第一条消息，开始聊天';list.append(empty);}}
  const onRecall=event=>{if(!context)return;historyRevision++;loading=false;$('#chatLoadOlder').disabled=false;removeMessage(event.id);void cache(recallChatMessages(context.serverId,[event.id]));};
  function detach(){if(connection){connection.off('chat-message',onMessage);connection.off('chat-trim',onTrim);connection.off('chat-reset',onReset);connection.off('chat-recalled',onRecall);}connection=null;}
  document.addEventListener('chat-context',event=>{
    const next=event.detail;root.classList.add('chat-enabled');root.classList.toggle('chat-outside',!next.channelId);panel.classList.remove('hidden');
    const current=getSocket(),changed=context?.serverId!==next.serverId||connection!==current;context=next;
    requestAnimationFrame(layout);for(const message of messages.values())void paintAvatar(nodes.get(message.id).querySelector('.chat-message-avatar'),message);
    if(!changed)return;detach();connection=current;connection.on('chat-message',onMessage);connection.on('chat-trim',onTrim);connection.on('chat-reset',onReset);connection.on('chat-recalled',onRecall);
    const token=++generation;epoch=null;recalled.clear();avatars.clear();loading=false;hasMore=false;localHasMore=false;cacheFailed=false;settingsDirty=false;serverMaxAttachments=1;clearView();status('同步中…');
    void(async()=>{try{const stored=await readChatCache(next.serverId);if(token!==generation)return;epoch=epoch||stored.epoch;localHasMore=stored.messages.length===40;hasMore=localHasMore;render(stored.messages);}catch(error){console.error(error);}if(token===generation)await loadHistory();})();
  });
  new MutationObserver(()=>{if(!$('#room').classList.contains('active')){generation++;detach();context=null;epoch=null;loading=false;clearView();draftChanged();input.value='';sizeInput();pendingSend=null;panel.classList.add('hidden');root.classList.remove('chat-enabled','chat-outside');}}).observe($('#room'),{attributes:true,attributeFilter:['class']});
  $('#chatLoadOlder').onclick=()=>void loadHistory(true);
  async function choose(file,token) {
    if(token!==generation)return;
    if(!file)return;if(draft.length>=32)return toast('每条消息最多32个附件','error');if(serverLimit&&file.size+2048>serverLimit*1048576)return toast('文件超过服务器聊天存储上限','error');
    try{const type=chatImageType(new Uint8Array(await file.slice(0,16).arrayBuffer()));if(token!==generation)return;
      if(!type||file.size>20*1048576){draftChanged([...draft,{name:file.name||'文件',file}]);return;}
      const extension=type==='image/jpeg'?'jpg':type.slice(6),name=(file.name||'图片').replace(/\.[^./\\]+$/,'')+'.'+extension;
      const imageFile=file.slice(0,file.size,type);draftChanged([...draft,{name,file:imageFile,preview:URL.createObjectURL(imageFile),imageType:type}]);}catch(error){if(token===generation)toast(error.message,'error');}
  }
  function chooseFiles(files){const selected=[...files],token=generation;selectionQueue=selectionQueue.then(async()=>{for(const file of selected)await choose(file,token);});}
  $('#chatChooseImage').onclick=()=>$('#chatImageInput').click();$('#chatImageInput').onchange=event=>{chooseFiles(event.target.files);event.target.value='';};
  $('#chatComposer').addEventListener('paste',event=>{const files=[...event.clipboardData.items].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();chooseFiles(files);const text=event.clipboardData.getData('text/plain');if(text)insert(text);}});
  $('#chatComposer').ondragover=event=>event.preventDefault();$('#chatComposer').ondrop=event=>{event.preventDefault();chooseFiles(event.dataTransfer.files);};
  let composing=false;input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
  input.addEventListener('keydown',event=>{if(composing||event.isComposing||event.keyCode===229)return;
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!event.repeat)$('#chatComposer').requestSubmit();return;}
    if(['Backspace','Delete'].includes(event.key)&&!input.value&&draft.length){event.preventDefault();const image=draft.at(-1);if(activeUpload?.images.includes(image))activeUpload.abort();draftChanged(draft.slice(0,-1));}if(event.key==='Escape')$('#chatLinkFields').classList.add('hidden');});
  function insert(before,after='') {const start=input.selectionStart,selected=input.value.slice(start,input.selectionEnd);input.setRangeText(before+selected+after,start,input.selectionEnd,'end');if(!selected&&after)input.setSelectionRange(start+before.length,start+before.length);sizeInput();input.focus();}
  for(const button of panel.querySelectorAll('[data-before]'))button.onclick=()=>insert(button.dataset.before,button.dataset.after||'');
  $('#chatInsertLink').onclick=()=>{$('#chatLinkFields').classList.toggle('hidden');if(!$('#chatLinkFields').classList.contains('hidden'))$('#chatLinkInput').focus();};
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#chatLinkFields,#chatInsertLink'))$('#chatLinkFields').classList.add('hidden');});
  $('#chatLinkInput').onkeydown=event=>{if(event.key==='Escape'||['Backspace','Delete'].includes(event.key)&&!event.target.value){event.preventDefault();$('#chatLinkFields').classList.add('hidden');input.focus();}};
  $('#chatConfirmLink').onclick=()=>{const href=safeChatLink($('#chatLinkInput').value.trim());if(!href)return toast('请输入 HTTP 或 HTTPS 网页地址','error');if(input.selectionStart===input.selectionEnd)input.setRangeText('链接',input.selectionStart,input.selectionEnd,'select');insert('[',']('+href+')');$('#chatLinkFields').classList.add('hidden');};
  for(const emoji of ['😀','😂','🥰','😎','🤔','😭','👍','👎','❤️','🔥','🎉','👀','✅','❌','🙏','💪','🤝','🎮','💯','✨','😅','😴','🤯','👋']){const button=document.createElement('button');button.type='button';button.textContent=emoji;button.onclick=()=>{insert(emoji);$('#chatEmoji').open=false;};$('.chat-emoji-panel').append(button);}
  $('#chatEmoji').ontoggle=()=>{if(!$('#chatEmoji').open)return;const rect=$('#chatEmoji').getBoundingClientRect(),picker=$('.chat-emoji-panel');picker.style.position='fixed';picker.style.left=Math.max(8,rect.right-220)+'px';picker.style.top=Math.max(48,rect.top-180)+'px';picker.style.bottom='auto';picker.style.right='auto';};
  document.addEventListener('click',event=>{if(!$('#chatEmoji').contains(event.target))$('#chatEmoji').open=false;});
  list.onclick=event=>{const link=event.target.closest('a');if(link){event.preventDefault();const url=safeChatLink(link.href);if(url)window.electronAPI.openWebLink(url).catch(error=>toast(error.message,'error'));}};
  $('#chatCancelUpload').onclick=()=>activeUpload?.abort();
  $('#chatComposer').onsubmit=async event=>{
    event.preventDefault();if(!context||$('#chatSend').disabled)return;
    const token=generation,connection=getSocket();let task=null;
    $('#chatSend').disabled=true;
    try{
      await selectionQueue;if(token!==generation||!context)return;
      const text=input.value,images=[...draft];if(!text.trim()&&!images.length)return;
      if(images.length>serverMaxAttachments)throw Error('当前服务器不支持这么多附件，请更新服务端；每条消息最多32个附件');
      if(serverLimit&&images.reduce((sum,image)=>sum+image.file.size,2048+text.length*4)>serverLimit*1048576)throw Error('这条消息超过服务器聊天存储上限');
      if(!pendingSend||pendingSend.text!==text||pendingSend.images.length!==images.length||images.some((image,index)=>image!==pendingSend.images[index]))pendingSend={clientId:crypto.randomUUID(),text,images};
      const payload={clientId:pendingSend.clientId,text};
      if(images.length){
        task={connection,images,ids:new Set(),cancelled:false};
        const cancel=id=>void requestServer('chat-upload-cancel',{uploadId:id},connection).catch(()=>{});
        const stopped=new Promise((_,reject)=>{task.abort=()=>{if(task.cancelled)return;task.cancelled=true;reject(Error('上传已取消'));for(const id of task.ids)cancel(id);};});
        const wait=promise=>Promise.race([promise,stopped]);
        activeUpload=task;$('#chatCancelUpload').classList.remove('hidden');
        let sent=0;const total=images.reduce((sum,image)=>sum+image.file.size,0),ids=[];
        for(const image of images){
          if(token!==generation)throw Error('连接已变更，请重新发送文件');
          status('上传 '+(ids.length+1)+'/'+images.length+' · '+(total?Math.round(sent/total*100):0)+'%');
          const starting=requestServer('chat-upload-start',{name:image.name,bytes:image.file.size,imageType:image.imageType},connection);
          void starting.then(upload=>{task.ids.add(upload.uploadId);if(task.cancelled)cancel(upload.uploadId);}).catch(()=>{});
          const upload=await wait(starting);ids.push(upload.uploadId);
          for(let offset=0;offset<image.file.size;offset+=1048576){
            if(token!==generation)throw Error('连接已变更，请重新发送文件');
            const data=await wait(image.file.slice(offset,offset+1048576).arrayBuffer());
            await wait(requestServer('chat-upload-chunk',{uploadId:upload.uploadId,offset,data},connection,180000));sent+=data.byteLength;
            status('上传 '+ids.length+'/'+images.length+' · '+Math.min(100,Math.round(sent/total*100))+'%');
          }
        }
        if(task.cancelled)throw Error('上传已取消');
        if(ids.length===1)payload.uploadId=ids[0];else payload.uploadIds=ids;
        activeUpload=null;$('#chatCancelUpload').classList.add('hidden');status('发送中…');
      }
      let result;for(let attempt=0;;attempt++){
        if(token!==generation)return;
        try{result=await requestServer('chat-send',payload,connection,180000);break;}
        catch(error){if(attempt>=2||!error.message.includes('发送过于频繁'))throw error;await new Promise(resolve=>setTimeout(resolve,550));}
      }
      if(token!==generation)return;onMessage(result);if(input.value===text){input.value='';sizeInput();}draftChanged(draft.filter(image=>!images.includes(image)));pendingSend=null;status('');list.scrollTop=list.scrollHeight;
    }catch(error){
      task?.abort();
      if(token===generation)status(error.message==='上传已取消'?'上传已取消':error.message+'；可再次点击发送重试');
    }finally{if(activeUpload===task)activeUpload=null;if(token===generation){$('#chatSend').disabled=false;$('#chatCancelUpload').classList.add('hidden');}}
  };
  $('#serverChatSettingsForm').oninput=()=>{settingsDirty=true;};
  $('#serverChatSettingsForm').onsubmit=async event=>{event.preventDefault();try{const info=await requestServer('chat-settings',{days:Number($('#serverChatDays').value),maxMB:Number($('#serverChatMB').value)});settingsDirty=false;updateInfo(info);}catch(error){toast(error.message,'error');}};
  $('#serverChatClear').onclick=async()=>{const server=context?.serverId;if(!server||!await confirmClear('清除服务器保存的全部聊天记录和图片？用户本地已保存的记录不受影响。')||context?.serverId!==server)return;try{onReset(await requestServer('chat-clear'));}catch(error){toast(error.message,'error');}};
  async function refreshLocal() {
    const settings=chatCacheSettings();$('#chatCacheEnabled').checked=settings.enabled;$('#chatCacheDays').value=settings.days;$('#chatCacheMB').value=settings.maxMB;
    try{const servers=await chatCacheUsage();const target=$('#chatCacheServers');target.replaceChildren();for(const item of servers){const row=document.createElement('div');row.className='chat-cache-server';const name=document.createElement('span');name.textContent=item.name;const detail=document.createElement('small');detail.textContent=`${item.count} 条 · 约 ${sizeLabel(item.bytes)}`;name.append(detail);const button=document.createElement('button');button.type='button';button.className='btn btn-outline btn-sm';button.textContent='清除';button.onclick=async()=>{if(await confirmClear('仅清除本机保存的“'+item.name+'”聊天记录？服务器上的记录不受影响。')){await cache(clearChatCache(item.serverId));await refreshLocal();}};row.append(name,button);target.append(row);}}catch(error){console.error(error);}
  }
  $('#chatCacheSave').onclick=async()=>{try{await saveChatCacheSettings({enabled:$('#chatCacheEnabled').checked,days:Number($('#chatCacheDays').value),maxMB:Number($('#chatCacheMB').value)});await refreshLocal();}catch(error){toast(error.message,'error');}};
  $('#chatCacheClearAll').onclick=async()=>{if(await confirmClear('清除本机保存的所有服务器聊天记录？服务器上的记录不受影响。')){await cache(clearChatCache());await refreshLocal();}};
  new MutationObserver(()=>{if(!$('#settingsModal').classList.contains('hidden'))void refreshLocal();}).observe($('#settingsModal'),{attributes:true,attributeFilter:['class']});
}
