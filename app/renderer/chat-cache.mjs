let database, queue = Promise.resolve();
const settingsKey = 'chatCacheSettings';
export function chatCacheSettings() {
  let value;try{value=JSON.parse(localStorage.getItem(settingsKey));}catch{}
  return {enabled:value?.enabled!==false,days:Number.isInteger(value?.days)&&value.days>=0?value.days:30,maxMB:Number.isInteger(value?.maxMB)&&value.maxMB>=0?value.maxMB:256};
}
function open() {
  return database ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('screensh-chat',1);
    request.onupgradeneeded=()=>{const messages=request.result.createObjectStore('messages',{keyPath:'key'});messages.createIndex('server','serverId');messages.createIndex('sequence',['serverId','sequence']);request.result.createObjectStore('servers',{keyPath:'serverId'});request.result.createObjectStore('images',{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=null;reject(request.error);};
  });
}
function transaction(db,names,mode,work) {
  return new Promise((resolve,reject)=>{const tx=db.transaction(names,mode);let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('聊天缓存操作已取消'));work(tx,value=>{result=value;});});
}
function serialize(work) {const result=queue.then(work);queue=result.catch(()=>{});return result;}
async function clearRaw(serverId) {
  const db=await open();await transaction(db,['messages','servers','images'],'readwrite',tx=>{
    const messages=tx.objectStore('messages'),servers=tx.objectStore('servers');
    if(!serverId){messages.clear();servers.clear();tx.objectStore('images').clear();return;}
    servers.delete(serverId);const request=messages.index('server').openCursor(IDBKeyRange.only(serverId));request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();tx.objectStore('images').delete(cursor.primaryKey);cursor.continue();}};
  });
}
export function clearChatCache(serverId=null) {return serialize(()=>clearRaw(serverId));}
async function pruneRaw() {
  const db=await open(),settings=chatCacheSettings(),entries=[];let total=0;
  await transaction(db,['messages'],'readonly',tx=>{
    const request=tx.objectStore('messages').openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const record=cursor.value;entries.push({key:record.key,serverId:record.serverId,sequence:record.sequence,time:record.message.time,bytes:record.bytes});total+=record.bytes;cursor.continue();};
  });
  const cutoff=settings.days?Date.now()-settings.days*86400000:-Infinity,remove=new Set();
  for(const record of entries)if(record.time<cutoff){remove.add(record.key);total-=record.bytes;}
  entries.sort((a,b)=>a.time-b.time);
  for(const record of entries)if(settings.maxMB&&total>settings.maxMB*1048576&&!remove.has(record.key)){remove.add(record.key);total-=record.bytes;}
  if(remove.size)await transaction(db,['messages','images'],'readwrite',tx=>{for(const key of remove){tx.objectStore('messages').delete(key);tx.objectStore('images').delete(key);}});
}
export function saveChatCacheSettings(value) {
  if(typeof value.enabled!=='boolean'||!Number.isInteger(value.days)||value.days<0||value.days>36500||!Number.isInteger(value.maxMB)||value.maxMB<0||value.maxMB>1048576)return Promise.reject(Error('本地聊天记录设置无效'));
  localStorage.setItem(settingsKey,JSON.stringify(value));return serialize(()=>pruneRaw());
}
export function mergeChatCache(serverId,name,epoch,messages) {
  return serialize(async()=>{
    const enabled=chatCacheSettings().enabled;
    const db=await open();
    // Server retention and reset epochs never delete records saved on this device.
    if(!enabled){await pruneRaw();return;}
    await transaction(db,['messages','servers'],'readwrite',tx=>{
      const servers=tx.objectStore('servers'),meta=servers.get(serverId),store=tx.objectStore('messages');
      meta.onsuccess=()=>{const recalled=meta.result?.recalled||[];servers.put({...meta.result,serverId,name,epoch,recalled});
        for(const message of messages){if(recalled.includes(message.id))continue;const key=serverId+':'+message.id,request=store.get(key);request.onsuccess=()=>{const imageBytes=request.result?.imageBytes||0;store.put({key,serverId,sequence:message.sequence,message,imageBytes,bytes:new TextEncoder().encode(JSON.stringify(message)).length+imageBytes});};}
      };
    });await pruneRaw();
  });
}
export function recallChatMessages(serverId,ids){return serialize(async()=>{
  if(!ids.length)return;const db=await open();await transaction(db,['messages','servers','images'],'readwrite',tx=>{
    const servers=tx.objectStore('servers'),request=servers.get(serverId);request.onsuccess=()=>servers.put({...request.result,serverId,name:request.result?.name||'服务器',recalled:[...new Set([...(request.result?.recalled||[]),...ids])]});
    for(const id of ids){tx.objectStore('messages').delete(serverId+':'+id);tx.objectStore('images').delete(serverId+':'+id);}
  });
});}
export async function readChatCache(serverId,before=Infinity,limit=40) {
  await queue;if(!chatCacheSettings().enabled)return {messages:[],epoch:null};const db=await open();
  return transaction(db,['messages','servers'],'readonly',(tx,done)=>{
    const result={messages:[],epoch:null};const meta=tx.objectStore('servers').get(serverId);meta.onsuccess=()=>{result.epoch=meta.result?.epoch||null;};
    const request=tx.objectStore('messages').index('sequence').openCursor(IDBKeyRange.bound([serverId,0],[serverId,Number.isFinite(before)?before-1:Number.MAX_SAFE_INTEGER]),'prev');
    request.onsuccess=()=>{const cursor=request.result;if(cursor&&result.messages.length<limit){result.messages.unshift(cursor.value.message);cursor.continue();}else done(result);};
  });
}
export async function readChatImage(serverId,id,index) {
  await queue;const db=await open();return transaction(db,['images'],'readonly',(tx,done)=>{const request=tx.objectStore('images').get(serverId+':'+id);request.onsuccess=()=>done(index===undefined?request.result?.data||null:request.result?.items?.[index]||null);});
}
export function saveChatImage(serverId,id,data,index) {
  return serialize(async()=>{
    if(!chatCacheSettings().enabled)return;const db=await open();
    await transaction(db,['messages','images'],'readwrite',tx=>{const store=tx.objectStore('messages'),request=store.get(serverId+':'+id);request.onsuccess=()=>{const record=request.result;if(record){const images=tx.objectStore('images'),previous=images.get(record.key);previous.onsuccess=()=>{const saved={...previous.result,key:record.key,serverId};if(index===undefined)saved.data=data;else saved.items={...saved.items,[index]:data};const imageBytes=(saved.data?.length||0)+Object.values(saved.items||{}).reduce((sum,item)=>sum+item.length,0);store.put({...record,imageBytes,bytes:new TextEncoder().encode(JSON.stringify(record.message)).length+imageBytes});images.put(saved);};}};});await pruneRaw();
  });
}
export async function chatCacheUsage() {
  await queue;const db=await open(),servers=new Map();
  return transaction(db,['messages','servers'],'readonly',(tx,done)=>{
    const meta=tx.objectStore('servers').getAll();meta.onsuccess=()=>{for(const item of meta.result)servers.set(item.serverId,{...item,count:0,bytes:0});};
    const request=tx.objectStore('messages').openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor){done([...servers.values()]);return;}const record=cursor.value,item=servers.get(record.serverId);if(item){item.count++;item.bytes+=record.bytes;}cursor.continue();};
  });
}
