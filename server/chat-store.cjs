const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
function cleanSettings(value) {
  const days = value?.days, maxMB = value?.maxMB;
  if (!Number.isInteger(days) || days < 0 || days > 36500 || !Number.isInteger(maxMB) || maxMB < 0 || maxMB > 1048576) throw new Error('保存天数或容量设置无效，0 表示不限制');
  return {days, maxMB};
}
function imageBytes(image) {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image?.data || '');
  if (!match || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw new Error('请选择不超过20MB的 PNG、JPEG、GIF 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  const type = match[1];
  const valid = type === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'gif' ? /^GIF8[79]a$/.test(bytes.subarray(0,6).toString())
    : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
  if (!valid || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片格式无效或超过20MB');
  return {bytes, type, name: String(image.name || '图片').slice(0,120)};
}
function createChatStore({directory = null, now = Date.now} = {}) {
  const file = directory && path.join(directory, 'chat.json');
  let state = {epoch:randomUUID(), next:1, settings:{days:30,maxMB:512}, messages:[], recalled:[], authors:[]};
  const media = new Map();
  const uploads = new Map();
  if (file && fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file,'utf8'));
    cleanSettings(state.settings);
    if (!Array.isArray(state.messages) || !Number.isSafeInteger(state.next) || typeof state.epoch !== 'string') throw new Error('聊天记录文件无效，请从备份恢复');
    for (const message of state.messages) for(const item of [message.image,message.file].filter(Boolean)) if (!/^[a-f0-9]{64}\.(png|jpeg|gif|webp|file)$/.test(item.ref)) throw new Error('聊天附件索引无效');
    state.recalled ||= [];
    state.authors ||= state.messages.map(({id,authorId,time})=>({id,authorId,time}));
  }
  const mediaFile = ref => path.join(directory,'media',ref);
  function save(next) {
    if (file) {
      fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600}); fs.renameSync(file+'.tmp',file);
    }
    state = next;
  }
  function size(messages = state.messages) {
    const unique = new Map();
    for (const message of messages) for(const item of [message.image,message.file].filter(Boolean)) unique.set(item.ref,item.bytes);
    return messages.reduce((sum,message)=>sum+Buffer.byteLength(JSON.stringify(message)),0)+[...unique.values()].reduce((sum,bytes)=>sum+bytes,0);
  }
  function gc() {
    const keep = new Set(state.messages.flatMap(message=>[message.image?.ref,message.file?.ref].filter(Boolean)));
    if (directory && fs.existsSync(path.join(directory,'media'))) {
      for (const name of fs.readdirSync(path.join(directory,'media'))) if (/^[a-f0-9]{64}\.(png|jpeg|gif|webp|file)$/.test(name) && !keep.has(name)) {
        try{fs.unlinkSync(mediaFile(name));}catch(error){console.error('聊天图片清理失败:',error.message);}
      }
    }
    for (const ref of media.keys()) if (!keep.has(ref)) media.delete(ref);
  }
  function retained(messages, settings) {
    const cutoff = settings.days ? now()-settings.days*86400000 : -Infinity;
    const result = messages.filter(message=>message.time>=cutoff);
    // Count shared media only once, and remove oldest messages until within the byte budget.
    let bytes = size(result), index = 0;
    const uses = new Map(); for (const message of result) for(const item of [message.image,message.file].filter(Boolean)) uses.set(item.ref,(uses.get(item.ref)||0)+1);
    while (settings.maxMB && bytes > settings.maxMB*1048576 && index < result.length) {
      const message = result[index++]; bytes -= Buffer.byteLength(JSON.stringify(message));
      for(const item of [message.image,message.file].filter(Boolean)){const count=uses.get(item.ref)-1;uses.set(item.ref,count);if(!count)bytes-=item.bytes;}
    }
    return result.slice(index);
  }
  function prune() {
    for(const [id,upload] of uploads)if(now()-upload.updated>180000)cancelUpload(id);
    const messages = retained(state.messages,state.settings);
    if (messages.length === state.messages.length) return false;
    save({...state,messages});gc();return true;
  }
  function cancelUpload(id){const upload=uploads.get(id);if(upload?.path)fs.rmSync(upload.path,{force:true});uploads.delete(id);}
  function info() { return {epoch:state.epoch, minSequence:state.messages[0]?.sequence ?? state.next, settings:{...state.settings}, count:state.messages.length, bytes:size()}; }
  const api = {
    info,
    prune,
    history(before = Infinity, limit = 40) {
      prune();
      if (before !== Infinity && (!Number.isSafeInteger(before) || before < 1)) throw new Error('聊天分页参数无效');
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('每次最多读取50条消息');
      const candidates=state.messages.filter(message=>message.sequence<before);
      return {...info(), recalled:state.recalled.map(item=>item.id), messages:candidates.slice(-limit), hasMore:candidates.length>limit};
    },
    beginUpload(owner,payload) {
      prune();if([...uploads.values()].filter(item=>item.owner===owner).length>=2)throw Error('请等待当前文件发送完成');
      const bytes=payload?.bytes;
      if(!Number.isSafeInteger(bytes)||bytes<0||state.settings.maxMB&&bytes+2048>state.settings.maxMB*1048576)throw Error('文件超过服务器聊天存储上限');
      const imageType=payload.imageType;
      if(imageType&&(!/^image\/(png|jpeg|gif|webp)$/.test(imageType)||bytes>MAX_IMAGE_BYTES))throw Error('图片格式无效或超过20MB');
      const id=randomUUID(),upload={owner,bytes,received:0,imageType,name:String(payload.name||'文件').replace(/[\\/\x00-\x1f]/g,'_').slice(0,120),hash:createHash('sha256'),chunks:[],updated:now()};
      if(directory){fs.mkdirSync(path.join(directory,'uploads'),{recursive:true});upload.path=path.join(directory,'uploads',id);fs.writeFileSync(upload.path,'');}
      uploads.set(id,upload);return {uploadId:id};
    },
    uploadChunk(owner,payload) {
      const upload=uploads.get(payload?.uploadId);
      if(!upload||upload.owner!==owner)throw Error('文件上传已失效');
      const bytes=Buffer.from(payload.data||[]);
      if(payload.offset!==upload.received||!bytes.length||bytes.length>1048576||upload.received+bytes.length>upload.bytes)throw Error('文件分片无效');
      if(upload.path)fs.appendFileSync(upload.path,bytes);else upload.chunks.push(bytes);
      upload.hash.update(bytes);upload.received+=bytes.length;upload.updated=now();return {received:upload.received};
    },
    cancelUploads(owner){for(const [id,item] of uploads)if(item.owner===owner)cancelUpload(id);},
    cancelUpload(owner,id){if(uploads.get(id)?.owner===owner)cancelUpload(id);},
    close(){for(const id of uploads.keys())cancelUpload(id);},
    append(author, payload) {
      prune();
      if (!/^[a-f0-9-]{36}$/.test(payload?.clientId || '') || typeof payload?.text !== 'string' || payload.text.length>8000) throw new Error('消息无效，文字最多8000个字符');
      const duplicate=state.messages.find(message=>message.authorId===author.id&&message.clientId===payload.clientId);
      if (duplicate) {if(uploads.get(payload.uploadId)?.owner===(author.uploadOwner||author.id))cancelUpload(payload.uploadId);return {message:duplicate,duplicate:true};}
      const text=payload.text.trim();if(!text&&!payload.image&&!payload.uploadId)throw new Error('不能发送空消息');
      const message={id:randomUUID(),clientId:payload.clientId,sequence:state.next,time:now(),authorId:author.id,name:author.name,avatar:author.avatar||null,text};
      let image;
      if (payload.image) {
        image=imageBytes(payload.image);
        message.image={ref:createHash('sha256').update(image.bytes).digest('hex')+'.'+image.type,type:image.type,name:image.name,bytes:image.bytes.length};
      }
      const upload=payload.uploadId&&uploads.get(payload.uploadId);
      if(payload.uploadId){if(!upload||upload.owner!==(author.uploadOwner||author.id)||upload.received!==upload.bytes)throw Error('文件上传不完整或已失效');
        if(payload.image)throw Error('每条消息只能发送一个附件');
        if(upload.imageType){const bytes=upload.path?fs.readFileSync(upload.path):Buffer.concat(upload.chunks);image=imageBytes({data:'data:'+upload.imageType+';base64,'+bytes.toString('base64'),name:upload.name});}
        upload.ref ||= upload.hash.digest('hex')+'.'+(image?.type||'file');message[image?'image':'file']={ref:upload.ref,name:upload.name,bytes:upload.bytes,...(image?{type:image.type}:{})};}
      if (state.settings.maxMB&&size([message])>state.settings.maxMB*1048576) throw new Error('这条消息超过服务器聊天存储上限');
      if(upload){if(directory){fs.mkdirSync(path.join(directory,'media'),{recursive:true});if(!fs.existsSync(mediaFile(upload.ref)))fs.copyFileSync(upload.path,mediaFile(upload.ref));}else media.set(upload.ref,Buffer.concat(upload.chunks));}
      if (image) {
        if(directory){fs.mkdirSync(path.join(directory,'media'),{recursive:true});if(!fs.existsSync(mediaFile(message.image.ref)))fs.writeFileSync(mediaFile(message.image.ref),image.bytes,{mode:0o600});}
        else media.set(message.image.ref,image.bytes);
      }
      try {save({...state,next:state.next+1,messages:retained([...state.messages,message],state.settings),authors:[...state.authors,{id:message.id,authorId:message.authorId,time:message.time}]});}
      catch(error){gc();throw error;}
      if(upload)cancelUpload(payload.uploadId);gc();return {message,duplicate:false};
    },
    find(id){return state.messages.find(item=>item.id===id)||state.authors.find(item=>item.id===id);},
    recall(id,actorId,moderate=false){const message=api.find(id);if(!message){if(state.recalled.some(item=>item.id===id))return {id};throw Error('消息已不存在');}
      if(message.authorId===actorId){if(now()-message.time>120000)throw Error('只能撤回两分钟内的消息');}
      else if(!moderate)throw Error('只能撤回自己或权限更低成员的消息');
      save({...state,messages:state.messages.filter(item=>item.id!==id),authors:state.authors.filter(item=>item.id!==id),recalled:[...state.recalled,{id,time:now()}]});gc();return {id};},
    attachment(id){prune();const message=api.find(id);if(!message?.file)throw Error('文件已过期或不存在');
      const result={name:message.file.name,...(directory?{path:mediaFile(message.file.ref)}:{bytes:media.get(message.file.ref)})};
      if(/\.mp4$/i.test(result.name)){
        let header=result.bytes?.subarray(0,16);
        if(result.path){const fd=fs.openSync(result.path,'r');try{header=Buffer.alloc(16);fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}}
        if(header?.subarray(4,8).toString()==='ftyp'&&header.subarray(8,12).toString()!=='qt  ')result.type='video/mp4';
      }
      return result;},
    image(messageId) {
      prune();const message=state.messages.find(item=>item.id===messageId);
      if(!message?.image)throw new Error('图片已过期或不存在');
      const bytes=directory?fs.readFileSync(mediaFile(message.image.ref)):media.get(message.image.ref);
      if(!bytes)throw new Error('图片已不存在');
      return {id:message.id,data:'data:image/'+message.image.type+';base64,'+bytes.toString('base64')};
    },
    configure(settings) {const next=cleanSettings(settings);save({...state,settings:next,messages:retained(state.messages,next)});gc();return info();},
    clear() {save({...state,epoch:randomUUID(),messages:[]});gc();return info();},
  };
  if(directory&&fs.existsSync(path.join(directory,'uploads')))for(const name of fs.readdirSync(path.join(directory,'uploads')))if(/^[a-f0-9-]{36}$/.test(name))fs.rmSync(path.join(directory,'uploads',name),{force:true});
  prune();gc();return api;
}
module.exports={createChatStore};
