const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createSignalingServer}=require('../../../server/server');
const root=path.resolve(__dirname,'../..');
app.disableHardwareAcceleration();app.setPath('userData',path.join(root,'.runtime-probe','chat-times-'+process.pid));
app.on('window-all-closed',()=>{});
for(const [name,value] of Object.entries({'get-hardware-acceleration':false,'get-login-startup':false,'get-tunnel-mode':'tun','start-easytier':'10.144.1.1','leave-runtime':null,'stop-sharing':null,'lolping-get':{config:{enabled:false}},'lolping-sync':null,'confirm-startup':null,'set-voice-timing':null,'get-update-settings':{enabled:false,status:'current'},'get-update-acceleration':{enabled:false,source:'https://gh-proxy.com',customUrl:'',sources:['https://gh-proxy.com']},'save-server-password':null}))ipcMain.handle(name,()=>value);
app.whenReady().then(async()=>{
 const {server,io}=createSignalingServer({initialPeers:'test.example:11010'});let win,connections=0;io.on('connection',()=>connections++);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({width:960,height:640,show:false,frame:false,webPreferences:{preload:path.join(root,'preload.js'),backgroundThrottling:false}});
  const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  const wait=async code=>{for(let i=0;i<150;i++){if(await run('return '+code))return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Chat timestamp timeout: '+code);};
  await win.loadFile(path.join(root,'renderer/index.html'));
  await run(`localStorage.setItem('serverUrl','http://127.0.0.1:${server.address().port}');localStorage.setItem('autoConnectLastServer','false')`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
  await run(`await import('./renderer.js')`);await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(connections,0,'saved homepage address does not trigger a connectivity probe');
  assert.equal(await run(`return !document.querySelector('#btnTestServer')&&!document.querySelector('#serverStatus')`),true);
  await run(`window.channelVoice={sync(){},stop:async()=>{},decorate(){}};document.querySelector('#userName').value='时间测试';document.querySelector('#btnConnect').click()`);
  await wait(`document.querySelector('#room').classList.contains('active')&&document.querySelector('#chatStatus').textContent===''`);
  await run(`
   const {socket,requestServer}=await import('./signaling.js');const info=await requestServer('chat-history',{});
   window.deliverMessage=message=>socket.listeners('chat-message').forEach(fn=>fn({epoch:info.epoch,message}));
   window.recallMessage=id=>socket.listeners('chat-recalled').forEach(fn=>fn({id}));
   const now=new Date(),stamp=(offset,hour,minute)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset,hour,minute).getTime();
   window.fixtureMessages=[['a',1,-2,9,15,'one'],['b',2,-2,9,16,'two'],['c',3,-1,10,0,'two'],['d',4,-1,10,1,'two'],['e',5,0,11,0,'two'],['f',6,0,11,1,'one'],['g',7,0,11,2,'one']].map(([id,sequence,offset,hour,minute,authorId])=>({id,sequence,time:stamp(offset,hour,minute),authorId,name:authorId,text:'测试消息 '+id}));
   window.fixtureMessages.forEach(window.deliverMessage);
   window.readTime=id=>document.querySelector('.chat-message[data-message-id="'+id+'"] .chat-message-heading time').textContent;
   window.dateLabel=time=>{const d=new Date(time);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  `);
  assert.deepEqual(await run(`return fixtureMessages.map(message=>readTime(message.id))`),await run(`return fixtureMessages.map((message,index)=>dateLabel(message.time)+' '+['09:15','09:16','10:00','10:01','11:00','11:01','11:02'][index])`),'all full message headings include the date, including today');
  assert.equal(await run(`const historical=document.querySelector('[data-message-id=d] .chat-message-hover-time'),today=document.querySelector('[data-message-id=g] .chat-message-hover-time');return historical.textContent==='10:01'&&!historical.classList.contains('has-date')&&today.textContent==='11:02'&&!today.classList.contains('has-date')&&document.querySelector('[data-message-id=g]').classList.contains('chat-message-grouped')`),true,'grouped messages omit the hover date for both historical days and today');
  assert.equal(await run(`return !document.querySelector('[data-message-id=c]').classList.contains('chat-message-grouped')&&document.querySelector('[data-message-id=d]').classList.contains('chat-message-grouped')&&!document.querySelector('[data-message-id=e]').classList.contains('chat-message-grouped')`),true,'consecutive authors start a fresh heading at date boundaries');
  await run(`deliverMessage({...fixtureMessages[0],id:'older',sequence:0,time:fixtureMessages[0].time-3600000})`);
  assert.equal(await run(`return readTime('older')===dateLabel(fixtureMessages[0].time)+' 08:15'&&readTime('a')===dateLabel(fixtureMessages[0].time)+' 09:15'&&document.querySelector('[data-message-id=a]').classList.contains('chat-message-grouped')&&document.querySelector('[data-message-id=a] .chat-message-hover-time').textContent==='09:15'`),true,'prepending history groups the historical message and shows only its time on hover');
  await run(`recallMessage('older')`);
  assert.equal(await run(`return readTime('a')`),await run(`return dateLabel(fixtureMessages[0].time)+' 09:15'`));
  await run(`recallMessage('a')`);
  assert.equal(await run(`return readTime('b')`),await run(`return dateLabel(fixtureMessages[1].time)+' 09:16'`),'historical messages retain the full date after recall');
  await run(`recallMessage('f')`);
  assert.equal(await run(`return !document.querySelector('[data-message-id=g]').classList.contains('chat-message-grouped')&&readTime('g')===dateLabel(fixtureMessages[6].time)+' 11:02'`),true,'recalling a group leader restores the full heading on a message from today');
  win.showInactive();await new Promise(resolve=>setTimeout(resolve,180));fs.mkdirSync(path.join(root,'.runtime-probe'),{recursive:true});fs.writeFileSync(path.join(root,'.runtime-probe','chat-timestamps.png'),(await win.webContents.capturePage()).toPNG());
  console.log('CHAT_TIMESTAMPS_OK today, historical dates, hover, day boundaries, prepend, recall, no homepage probe');
 }catch(error){console.error(error.stack);process.exitCode=1;}
 finally{win?.destroy();await new Promise(resolve=>io.close(resolve));app.exit(process.exitCode||0);}
});
