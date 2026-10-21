const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createChatStore}=require('../chat-store.cjs');
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
function upload(store,owner,name,bytes,type){const {uploadId}=store.beginUpload(owner,{name,bytes:bytes.length,imageType:type});for(let offset=0;offset<bytes.length;offset+=1048576)store.uploadChunk(owner,{uploadId,offset,data:bytes.subarray(offset,offset+1048576)});return uploadId;}
test('multiple media persist as one atomic message, support indexed retrieval, deduplicate retries and recall together',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chat-multiple-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=createChatStore({directory}),author={id:'author',name:'A'};
  const video=fs.readFileSync(path.join(__dirname,'fixtures/chat-video.mp4'));
  const ids=[upload(store,author.id,'a.gif',gif,'image/gif'),upload(store,author.id,'file.txt',Buffer.from('hello')),upload(store,author.id,'b.gif',gif,'image/gif'),upload(store,author.id,'v.mp4',video)];
  const payload={clientId:randomUUID(),text:'caption',uploadIds:ids};const {message}=store.append(author,payload);
  assert.equal(store.info().count,1);assert.equal(message.attachments.length,4);assert.equal(message.text,'caption');assert.equal(message.image,undefined);
  assert.equal(store.image(message.id,0).data,store.image(message.id,2).data);assert.throws(()=>store.image(message.id,1),/不存在/);
  assert.equal(fs.readFileSync(store.attachment(message.id,1).path,'utf8'),'hello');assert.equal(store.attachment(message.id,3).type,'video/mp4');
  for(const index of [-1,'0',null,4])assert.throws(()=>store.image(message.id,index),/不存在/);
  const retryIds=[upload(store,author.id,'a.gif',gif,'image/gif')];assert.equal(store.append(author,{...payload,uploadIds:retryIds}).duplicate,true);assert.equal(store.info().count,1);assert.deepEqual(fs.readdirSync(path.join(directory,'uploads')),[]);
  const restored=createChatStore({directory});assert.equal(restored.history().messages[0].attachments.length,4);assert.equal(restored.image(message.id,2).data,'data:image/gif;base64,'+gif.toString('base64'));
  restored.recall(message.id,author.id);assert.equal(restored.info().count,0);assert.deepEqual(fs.readdirSync(path.join(directory,'media')),[]);
});
test('batch validation rejects incomplete, foreign, repeated and oversized attachments without publishing a partial message',()=>{
  const store=createChatStore(),author={id:'a',name:'A'};const id=upload(store,'a','a.gif',gif,'image/gif'),foreign=upload(store,'b','b.gif',gif,'image/gif'),partial=store.beginUpload('a',{name:'partial',bytes:8}).uploadId;
  const payload={clientId:randomUUID(),text:'',uploadIds:[id,partial]};
  assert.throws(()=>store.append(author,payload),/不完整/);assert.equal(store.info().count,0);
  assert.throws(()=>store.append(author,{...payload,uploadIds:[id,foreign]}),/失效/);
  assert.throws(()=>store.append(author,{...payload,uploadIds:[id,id]}),/不同/);
  assert.throws(()=>store.append(author,{...payload,uploadIds:Array.from({length:33},()=>randomUUID())}),/32/);
  store.cancelUploads('a');store.configure({days:0,maxMB:1});const a=upload(store,'a','a.bin',Buffer.alloc(600000,1)),b=upload(store,'a','b.bin',Buffer.alloc(600000,2));
  assert.throws(()=>store.append(author,{...payload,uploadIds:[a,b]}),/上限/);assert.equal(store.info().count,0);store.close();
});
test('retention counts shared media once across batch messages and cleans every attachment',()=>{
  let now=Date.now();const store=createChatStore({now:()=>now}),author={id:'a',name:'A'};
  const ids=[upload(store,'a','a.gif',gif,'image/gif'),upload(store,'a','b.gif',gif,'image/gif')];const {message}=store.append(author,{clientId:randomUUID(),text:'',uploadIds:ids});
  assert.equal(store.info().bytes,Buffer.byteLength(JSON.stringify(message))+gif.length);
  now+=2*86400000;store.configure({days:1,maxMB:0});assert.equal(store.info().count,0);assert.throws(()=>store.image(message.id,0),/不存在/);
});
