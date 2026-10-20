// Real renderer, transparent overlay, IPC, channel server and compiled helper.
// --simulate exercises the helper protocol without intercepting the user's input.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createSignalingServer } = require('../../../server/server');
const { LolPingRuntime } = require('../../lolping/runtime.cjs');
const { EasyTierLolPing } = require('../../lolping/easytier.cjs');
const core = require('../../lolping/dist/main/core.cjs');
const root = path.resolve(__dirname, "../.."), profile = path.join(root, '.runtime-probe', 'lolping-ui-' + process.pid);
app.disableHardwareAcceleration(); app.setPath('userData', profile); app.on('window-all-closed', () => {});
const windows = [], runtimes = new Map(), errors = [];
const execute = (win, code) => win.webContents.executeJavaScript(code, true);
const wait = async predicate => { for (let n=0;n<200;n++) { if (await predicate()) return; await new Promise(resolve=>setTimeout(resolve,50)); } throw Error('lolPing smoke timeout'); };
app.whenReady().then(async () => {
  const { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  const runtime = event => runtimes.get(event.sender.id);
  ipcMain.handle('get-hardware-acceleration', () => false); ipcMain.handle('get-login-startup', () => false); ipcMain.handle('save-server-password', () => {});
  ipcMain.handle('start-easytier', event => '127.0.0.' + (windows.findIndex(w=>w.webContents.id===event.sender.id)+2));
  ipcMain.handle('stop-sharing', () => {}); ipcMain.handle('leave-runtime', event => runtime(event).stop());
  ipcMain.handle('lolping-get', (event,id) => runtime(event).get(id));
  ipcMain.handle('lolping-save', (event,id,config) => runtime(event).save(id,config));
  ipcMain.handle('lolping-sync', (event,context) => runtime(event).sync(context));
  ipcMain.handle('lolping-input-suspend',(event,on)=>runtime(event).suspendInput(on));
  ipcMain.handle('lolping-preview',(event,kind,id)=>runtime(event).preview(kind,id));
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    class SimBridge extends core.InputBridge { constructor(opts) { super({ ...opts, args: ['--simulate'] }); } }
    const ipcBaseline = ipcMain.listenerCount('overlay:pinged'), displayBaseline = require('electron').screen.listenerCount('display-added');
    for (let i=0;i<2;i++) {
      const win = new BrowserWindow({ width:960,height:640,show:false,webPreferences:{partition:`lolping-${process.pid}-${i}`,preload:path.join(root,'preload.js')} });
      windows.push(win); win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
      runtimes.set(win.webContents.id,new LolPingRuntime({file:path.join(profile,`config-${i}.json`),helper:path.join(root,'res/lolping-hook-helper.exe'),core:{...core,InputBridge:SimBridge},transportFactory:options=>new EasyTierLolPing({...options,allowLoopback:true}),send:(channel,data)=>{if(!win.isDestroyed())win.webContents.send(channel,data);}}));
      await win.loadFile(path.join(root,'renderer/index.html'));
      await execute(win,`(async()=>{await import('./renderer.js');window.channelVoice={sync(){},stop:async()=>{},decorate(){}};})()`);
      if (i===0) {
        await execute(win,`document.querySelector('#btnSettings').click();document.querySelector('#lolPingEnabled').click()`);
        const local = runtimes.get(win.webContents.id);
        await wait(()=>local.context?.channelId===null&&local.bridge?.status==='running');
        assert.equal(local.context.serverId,'00000000-0000-0000-0000-000000000000');
        assert.equal(local.transport,null,'home-page lolPing never starts a network transport');
        assert.equal(await execute(win,`document.querySelector('#serverSettingsDialog #lolPingEnabled')===null && !!document.querySelector('#settingsModal #lolPingEnabled')`),true);
        await execute(win,`document.querySelector('#lolPingEnabled').click()`);
        await wait(()=>!local.bridge&&!local.overlay);
        await execute(win,`document.querySelector('#btnCloseSettings').click()`);
      }
      await execute(win,`document.querySelector('#serverUrl').value='http://127.0.0.1:${server.address().port}';document.querySelector('#userName').value='Ping ${i}';document.querySelector('#btnConnect').click();`);
      await wait(()=>execute(win,`document.querySelector('#room').classList.contains('active')`));
    }
    for (const win of windows) {
      await execute(win,`document.querySelector('#btnSettings').click()`);
      await wait(()=>execute(win,`!document.querySelector('#lolPingEnabled').checked`));
      await execute(win,`document.querySelector('#btnLolPingConfig').click()`);
      await wait(()=>execute(win,`!document.querySelector('#lolPingDialog').classList.contains('hidden')`));
      assert.equal(await execute(win,`document.querySelectorAll('#lolPingForm select[name^="wheel"]').length`),8);
      assert.equal(await execute(win,`document.querySelectorAll('.lolping-wheel-layout button').length`),18);
      // Drag a palette item to a slice, preview it, then restore the League layout.
      await execute(win,`(()=>{const details=document.querySelector('details[data-setting="wheel"]');details.open=true;const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify({key:'wheel',id:'bait'}));details.querySelector('.lolping-wheel-layout button').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}));})()`);
      assert.equal(await execute(win,`document.querySelector('[name="wheel0"]').value`),'bait');
      await execute(win,`document.querySelector('details[data-setting="wheel"] .lolping-wheel-layout button').click();[...document.querySelectorAll('details[data-setting="wheel"] button')].find(b=>b.textContent==='恢复默认布局').click()`);
      assert.equal(await execute(win,`document.querySelector('[name="wheel0"]').value`),'danger');
      await execute(win,`(()=>{const s=document.querySelector('[name="trigger"]');s.value='custom';s.dispatchEvent(new Event('change'));s.parentElement.querySelector('button').click();})()`);
      await wait(()=>execute(win,`document.querySelector('[name="trigger"]').parentElement.querySelector('button').textContent.includes('按下按键')`));
      await execute(win,`document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyG',key:'g',bubbles:true}));document.querySelector('[name="trigger"]').value='alt';document.querySelector('[name="trigger"]').dispatchEvent(new Event('change'))`);
      await execute(win,`document.querySelector('#lolPingForm [name="volume"]').value=31;document.querySelector('#lolPingForm').requestSubmit()`);
      await wait(()=>execute(win,`document.querySelector('#lolPingDialog').classList.contains('hidden')`));
      await execute(win,`document.querySelector('#lolPingEnabled').click()`);
      await wait(()=>runtimes.get(win.webContents.id).bridge?.status==='running');
    }
    const [a,b] = windows.map(w=>runtimes.get(w.webContents.id));
    await wait(()=>a.transport?.peers.size===1&&b.transport?.peers.size===1);
    assert.equal(b.get(b.context.serverId).config.volume,31);
    const overlay = () => BrowserWindow.getAllWindows().filter(w=>!windows.includes(w)&&!w.isDestroyed());
    await wait(()=>overlay().length===require('electron').screen.getAllDisplays().length*2);
    for (const win of overlay()) {
      await wait(()=>execute(win,`document.querySelector('#wheel').children.length>0`));
      assert.equal(win.isFocusable(),false);
      assert.equal(win.webContents.getLastWebPreferences().nodeIntegration,false);
    }
    const display = a.overlay.numbered()[0], screen = require('electron').screen;
    const physical = screen.dipToScreenRect(null,display.bounds), x=Math.round(physical.x+physical.width*.4), y=Math.round(physical.y+physical.height*.4);
    const gestureFor = (runtime,vk,t) => runtime.bridge.child.stdin.write([
      {ev:'kdown',vk,t}, {ev:'mdown',btn:'left',x,y,t:t+10}, {ev:'move',x,y:y-180,t:t+30},
      {ev:'mup',btn:'left',x,y:y-180,t:t+60}, {ev:'kup',vk,t:t+70},
    ].map(event=>JSON.stringify({type:'sim',...event})+'\n').join(''));
    const gesture=(vk,t)=>gestureFor(a,vk,t);
    gesture(0x12,100);
    await wait(async()=>{let count=0;for(const win of overlay())if(await execute(win,`document.querySelector('#pings').children.length>0`))count++;return count===2;});
    gesture(0x11,300);
    await wait(async()=>{let count=0;for(const win of overlay())if(await execute(win,`document.querySelector('#emotes').children.length>0`))count++;return count===2;});
    assert.equal(a.overlay.missingAssets.size,0); assert.equal(b.overlay.missingAssets.size,0);
    // Room windows and data use the same real encrypted UDP path as marks.
    const roomErrors=[];
    const roomWindow=mode=>a.windows?.windows.get(mode);
    const attachErrors=w=>w.webContents.on('console-message',(_event,level,message)=>{if(level>=3)roomErrors.push(message);});
    windows[0].show();windows[0].focus();
    const simulate=events=>a.bridge.child.stdin.write(events.map(e=>JSON.stringify({type:'sim',...e})+'\n').join(''));
    simulate([{ev:'kdown',vk:0x12,t:1000},{ev:'kdown',vk:0x54,t:1010},{ev:'kup',vk:0x54,t:1020},{ev:'kup',vk:0x12,t:1030}]);
    await wait(()=>roomWindow('text')?.isVisible());attachErrors(roomWindow('text'));
    assert.equal(a.inputSuspended,true,'native gestures suspended while typing');
    assert.ok(roomWindow('text').webContents.getURL().includes('/text/index.html'));
    await execute(roomWindow('text'),`document.querySelector('input').value='/unknown';document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await wait(()=>execute(roomWindow('text'),`document.querySelector('#hint').textContent==='未知指令'`));
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-text-original.png'),(await roomWindow('text').webContents.capturePage()).toPNG());
    await execute(roomWindow('text'),`document.querySelector('input').value='文字同步测试';document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await wait(()=>b.room.history.some(h=>h.text.includes('文字同步测试')));
    assert.equal(a.inputSuspended,false,'typing closes and native gestures resume');
    await wait(async()=>{for(const w of overlay())if(await execute(w,`document.body.textContent.includes('文字同步测试')`))return true;return false;});
    simulate([{ev:'kdown',vk:9,t:1100}]);await wait(()=>roomWindow('panel')?.isVisible());attachErrors(roomWindow('panel'));
    assert.equal(roomWindow('panel').isFocusable(),false);
    await wait(()=>execute(roomWindow('panel'),`!!document.querySelector('.board .member')`));
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-panel-original.png'),(await roomWindow('panel').webContents.capturePage()).toPNG());
    await execute(roomWindow('panel'),`document.querySelector('.speaker').click()`);
    assert.equal(a.room.blocked.size,1);
    b.room.text('不应显示',{d:1,x:.5,y:.5});await new Promise(r=>setTimeout(r,300));assert.equal(a.room.history.some(h=>h.text.includes('不应显示')),false);
    await execute(roomWindow('panel'),`document.querySelector('.speaker').click()`);
    simulate([{ev:'kup',vk:9,t:1200}]);await wait(()=>!roomWindow('panel').isVisible());
    simulate([{ev:'kdown',vk:9,t:1250}]);await wait(()=>roomWindow('panel').isVisible());
    await execute(roomWindow('panel'),`document.querySelector('.board-head .ready').click()`);simulate([{ev:'kup',vk:9,t:1270}]);
    await wait(()=>b.windows?.windows.get('vote')?.isVisible());attachErrors(b.windows.windows.get('vote'));
    assert.equal(b.windows.windows.get('vote').isFocusable(),false);
    await wait(()=>execute(b.windows.windows.get('vote'),`!!document.querySelector('.vote.ready video')&&[...document.querySelectorAll('video')].filter(v=>!v.hidden).some(v=>v.readyState>=2&&!v.error)`));
    await wait(()=>execute(roomWindow('vote'),`document.querySelector('.status .title')?.textContent==='已接受'`));
    await wait(()=>execute(roomWindow('vote'),`[...document.querySelectorAll('video')].some(v=>!v.hidden&&v.src.endsWith('ready-accepted-idle.webm')&&v.readyState>=2&&!v.paused&&!v.error)`));
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-ready-original.png'),(await b.windows.windows.get('vote').webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-accepted-original.png'),(await roomWindow('vote').webContents.capturePage()).toPNG());
    await execute(b.windows.windows.get('vote'),`document.querySelector('.accept').click()`);
    await wait(()=>a.room.history.some(h=>h.text.includes('就位确认：通过')));
    assert.equal(roomWindow('vote').isVisible(),true,'accepted result stays visible instead of disappearing immediately');
    assert.equal(a.room.view().voteOver,true);
    await wait(async()=>{for(const w of overlay())if(await execute(w,`document.body.textContent.includes('所有人都已就位')`))return true;return false;});
    await wait(()=>!roomWindow('vote').isVisible());
    simulate([{ev:'kdown',vk:0x12,t:1300},{ev:'kdown',vk:0x54,t:1310},{ev:'kup',vk:0x54,t:1320},{ev:'kup',vk:0x12,t:1330}]);
    await wait(()=>roomWindow('text')?.isVisible());
    await execute(roomWindow('text'),`document.querySelector('input').value='/ff';document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await wait(()=>b.windows.windows.get('vote').isVisible());
    await wait(()=>execute(b.windows.windows.get('vote'),`!!document.querySelector('.vote.surrender button.yes')`));
    assert.ok(Math.abs(b.windows.windows.get('vote').getBounds().width-223)<=1,'original surrender size, allowing Windows DPI rounding');
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-surrender-original.png'),(await b.windows.windows.get('vote').webContents.capturePage()).toPNG());
    await execute(b.windows.windows.get('vote'),`document.querySelector('.foot .no').click()`);
    await wait(()=>a.room.history.some(h=>h.text.includes('投降投票：未通过')));
    assert.equal(a.room.view().voteOver,true);
    a.room.startVote('ready');await wait(()=>execute(b.windows.windows.get('vote'),`!!document.querySelector('.vote.ready .decline:not(:disabled)')`));
    await execute(b.windows.windows.get('vote'),`document.querySelector('.decline').click()`);
    await wait(()=>execute(b.windows.windows.get('vote'),`!!document.querySelector('.scene.declined')&&document.querySelector('.status .title')?.textContent==='已拒绝'`));
    await execute(b.windows.windows.get('vote'),`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-declined-original.png'),(await b.windows.windows.get('vote').webContents.capturePage()).toPNG());
    await a.save(a.context.serverId,{trigger:{vk:0x46},features:{...a.settings().features,roomText:false,roomPanel:false,roomVotes:false}});
    const cfg=core.configCommand(a.settings(),true,{text:a.settings().features.roomText,panel:a.settings().features.roomPanel});
    assert.equal(cfg.triggerVk,0x46);assert.equal(cfg.textVk,0);assert.equal(cfg.panelVk,0);
    let customShared=false;a.overlay.once('shared',()=>{customShared=true;});gesture(0x46,2000);await wait(()=>customShared);
    await a.save(a.context.serverId,{trigger:'alt',features:{...a.settings().features,roomText:true,roomPanel:true,roomVotes:true}});
    assert.deepEqual(roomErrors,[],'room windows have no renderer errors');
    const received = overlay().find(w=>w.webContents.getURL().includes('/overlay/'));
    assert.ok(received);
    const guest = windows[1];
    await execute(guest,`document.querySelector('#btnLolPingConfig').click()`);
    await wait(()=>execute(guest,`!document.querySelector('#lolPingDialog').classList.contains('hidden')`));
    const geometry = await execute(guest,`(()=>{const el=document.querySelector('#lolPingDialog .modal-content'),r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,scroll:el.scrollHeight>el.clientHeight};})()`);
    assert.ok(geometry.top>=0&&geometry.bottom<=geometry.height+2&&geometry.scroll,JSON.stringify(geometry));
    guest.show(); await execute(guest,`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`); await new Promise(resolve=>setTimeout(resolve,250));
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-settings.png'),(await guest.webContents.capturePage()).toPNG());
    await execute(guest,`(()=>{const d=document.querySelector('details[data-setting="wheel"]');d.open=true;d.scrollIntoView({block:'start'});})()`);await new Promise(r=>setTimeout(r,100));
    fs.writeFileSync(path.join(root,'.runtime-probe/lolping-wheel.png'),(await guest.webContents.capturePage()).toPNG());
    assert.ok(await execute(guest,`(()=>{const el=document.querySelector('#lolPingDialog .modal-content');el.scrollTop=el.scrollHeight;const r=document.querySelector('#btnSaveLolPing').getBoundingClientRect(),c=el.getBoundingClientRect();return r.bottom<=c.bottom+2&&r.top>=c.top;})()`),'save action remains reachable at minimum window size');
    await execute(guest,`document.querySelector('#btnCloseLolPing').click();document.querySelector('#btnCloseServerSettings').click();document.querySelector('#btnLeaveChannel').click()`);
    await wait(()=>b.context?.channelId===null&&b.bridge?.status==='running'&&b.transport===null);
    assert.equal(b.room,null);
    await wait(()=>a.transport.peers.size===0);
    await wait(async()=>{for(const w of b.overlay.windows.values())if(!await execute(w,`document.querySelector('#wheel')?.children.length>0`))return false;return true;});
    await new Promise(resolve=>setTimeout(resolve,150));
    let localPing=false,localEmote=false,leaked=0;
    const receive=a.receive.bind(a);a.receive=packet=>{if(packet.from===b.context.socketId&&['ping','emote'].includes(packet.kind))leaked++;receive(packet);};
    b.overlay.once('shared',()=>{localPing=true;});gestureFor(b,0x12,3000);await wait(()=>localPing);
    b.overlay.once('sharedEmote',()=>{localEmote=true;});gestureFor(b,0x11,3200);await wait(()=>localEmote);
    await new Promise(resolve=>setTimeout(resolve,200));assert.equal(leaked,0,'outside-channel gestures are visible only on this client');
    assert.ok(a.overlay&&a.bridge,'other channel participant stays active');
    await wait(()=>execute(guest,`(async()=>{const {state}=await import('./shared.js');return state.channelId===null&&!state.switchingChannel;})()`));
    await execute(guest,`document.querySelector('.channel-button').click()`);
    await wait(()=>b.context?.channelId&&b.bridge?.status==='running'&&b.transport?.peers.size===1);
    const previousBridge = b.bridge;
    await execute(guest,`(async()=>{const {socket}=await import('./signaling.js');socket.io.engine.close();})()`);
    await wait(()=>b.bridge&&b.bridge!==previousBridge&&b.bridge.status==='running');
    assert.equal(b.get(b.context.serverId).config.enabled,true,'rejoining/reconnecting restores the local server preference');
    await execute(guest,`document.querySelector('#btnLeaveChannel').click()`);
    await wait(()=>b.context?.channelId===null&&b.bridge?.status==='running'&&b.transport===null);
    await execute(guest,`document.querySelector('#btnLeave').click()`);
    await wait(()=>b.context?.serverId==='00000000-0000-0000-0000-000000000000'&&b.bridge?.status==='running'&&b.transport===null);
    await b.save(b.context.serverId,{enabled:false});await wait(()=>b.overlay===null&&b.bridge===null);
    const serverId = a.context.serverId;
    await execute(windows[0],`document.querySelector('#btnSettings').click();document.querySelector('#lolPingEnabled').click()`);
    await wait(()=>a.overlay===null&&a.bridge===null);
    assert.equal(overlay().length,0);
    assert.equal(ipcMain.listenerCount('overlay:pinged'),ipcBaseline);
    assert.equal(require('electron').screen.listenerCount('display-added'),displayBaseline,'display hotplug listeners are released');
    assert.equal(new LolPingRuntime({file:path.join(profile,'config-0.json'),helper:'',send(){},core}).get(serverId).config.enabled,false);
    assert.equal(ipcMain.listenerCount('lolping-room-action'),0,'room action handlers removed');
    assert.deepEqual(errors,[]);
    console.log('LOLPING_UI_OK',JSON.stringify({nativeHelperProtocol:true,realOverlay:true,sameChannelPing:true,encryptedDirectUDP:true,roomText:true,originalPanelAndText:true,originalVoteArtwork:true,readyCountdownAndAcceptedIdle:true,readyDecline:true,voteResultRetained:true,individualBlock:true,customKey:true,featureKeyRelease:true,reconnectRestoresSession:true,localConfig:true,outsideChannelLocalOnly:true,disableCleanup:true,smallWindow:geometry,rendererErrors:errors}));
  } catch(error) { console.error(error.stack);for(const r of runtimes.values())console.error('ROOM_DEBUG',r.status,r.settings?.().features,[...(r.windows?.windows||[])].map(([mode,w])=>({mode,visible:w.isVisible(),url:w.webContents.getURL()})));process.exitCode=1; }
  finally { for(const r of runtimes.values())await r.stop().catch(()=>{}); windows.forEach(w=>w.destroy()); await new Promise(resolve=>io.close(resolve)); app.exit(process.exitCode||0); }
});
