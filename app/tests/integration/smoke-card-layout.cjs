const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {setMemberSidebarCollapsed,MIN_WINDOW_WIDTH,COMPACT_WINDOW_WIDTH,MIN_WINDOW_HEIGHT}=require('../../main/window-state.cjs');
const root = path.resolve(__dirname, "../..");
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'card-layout-' + process.pid));
app.on('window-all-closed', () => {}); ipcMain.handle('get-hardware-acceleration', () => false);
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, frame: false, width: 960, height: 640, minWidth: MIN_WINDOW_WIDTH, minHeight: MIN_WINDOW_HEIGHT, webPreferences: { preload: path.join(root,'preload.js'), backgroundThrottling: false } });
    ipcMain.on('window-members-sidebar', (event, collapsed) => {
      if (event.sender === win.webContents) setMemberSidebarCollapsed(win, screen, collapsed);
    });
    const run = code => win.webContents.executeJavaScript(code, true);
    await win.loadFile(path.join(root,'renderer/index.html'));
    await run(`(async()=>{ await import('./renderer.js'); const {state}=await import('./shared.js'); state.roomId='layout';state.channelId='main';state.channels=[{id:'main',name:'主频道'}];
      const users=Array.from({length:4},(_,i)=>({socketId:i===0?undefined:'user-'+i,name:i===0?'自己':'成员 '+i,role:i===0?'host':'member',channelId:'main',voiceEnabled:true}));state.serverUsers=users;
      document.querySelector('#lobby').classList.remove('active');document.querySelector('#room').classList.add('active');(await import('./room.js')).updateUserList(users); })()`);
    await run(`Promise.allSettled(document.querySelector('#serverMembersSidebar').getAnimations().map(animation=>animation.finished))`);
    await run(`document.querySelector('.microphone-settings-link').click()`);
    assert.equal(await run(`!document.querySelector('#settingsModal').classList.contains('hidden') && document.querySelector('#settings-tab-voice').getAttribute('aria-selected')==='true' && !document.querySelector('#settings-panel-voice').hidden && document.querySelector('#settings-panel-general').hidden`), true, 'microphone settings opens Voice directly');
    await run(`document.querySelector('#btnCloseSettings').click();document.querySelector('#btnRoomSettings').click()`);
    assert.equal(await run(`document.querySelector('#settings-tab-general').getAttribute('aria-selected')`), 'true', 'the main settings entry still opens General');
    await run(`document.querySelector('#btnCloseSettings').click()`);
    const measurements=[];
    for(const [width,height] of [[960,640],[1200,720],[1440,900],[1600,1000],[1920,1080]]) {
      win.setSize(width,height); await new Promise(r=>setTimeout(r,300));
      const result=await run(`(()=>{const box=document.querySelector('#mainContent').getBoundingClientRect();const cards=[...document.querySelectorAll('.user-card')].map(c=>{const r=c.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}});return {width:innerWidth,height:innerHeight,viewport:{left:box.left,top:box.top,right:box.right,bottom:box.bottom},cards,scrollWidth:document.querySelector('#mainContent').scrollWidth,clientWidth:document.querySelector('#mainContent').clientWidth};})()`);
      assert.equal(result.cards.length,4);assert.ok(result.scrollWidth<=result.clientWidth,'no horizontal overflow');
      for(const card of result.cards) {assert.ok(card.right<=result.viewport.right && card.left>=result.viewport.left,JSON.stringify(result));assert.ok(card.bottom<=result.viewport.bottom,'four cards must be fully visible');assert.ok(card.width<=320,'cards keep their original maximum width');}
      assert.equal(await run(`document.querySelector('.room-sidebar').getBoundingClientRect().width`),238);
      assert.equal(await run(`getComputedStyle(document.querySelector('#userCardsView')).paddingLeft`),'12px');
      assert.equal(await run(`getComputedStyle(document.querySelector('.cards-grid')).gap`),'16px');
      const footerOffsets=await run(`[...document.querySelectorAll('.user-card')].map(card=>card.getBoundingClientRect().bottom-card.querySelector('.card-voice-row,.remote-card-actions').getBoundingClientRect().bottom)`);
      assert.ok(footerOffsets.every(value=>Math.abs(value-footerOffsets[0])<1),'own and remote controls share the same bottom inset');
      assert.ok(footerOffsets[0]<8,'controls sit closer to the bottom edge');
      if(width===960) {assert.equal(result.cards.filter(c=>Math.abs(c.top-result.cards[0].top)<1).length,2);assert.ok(result.cards[2].top>result.cards[0].top);assert.ok(Math.abs(result.cards[0].left-result.viewport.left-12)<1,'the first card keeps the grid inset');win.show();await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(root,'.runtime-probe','cards-minimum.png'),(await win.webContents.capturePage()).toPNG());}
      measurements.push({window:[result.width,result.height],card:[result.cards[0].width,result.cards[0].height]});
    }
    assert.ok(measurements[3].card[0]>measurements[0].card[0]);assert.ok(measurements[3].card[1]>measurements[0].card[1]);
    assert.equal(measurements[0].card[0],221,"original card width at 960 pixels");
    assert.ok(Math.abs(measurements[0].card[1]-231.6)<2,"original card height at 960 pixels");
    await run(`document.querySelector('#btnToggleMembers').click()`);
    assert.deepEqual(win.getMinimumSize(),[COMPACT_WINDOW_WIDTH,MIN_WINDOW_HEIGHT]);
    win.setSize(COMPACT_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
    await run(`Promise.allSettled(document.querySelector('#serverMembersSidebar').getAnimations().map(animation=>animation.finished))`);
    const compact=await run(`(() => {
      const main=document.querySelector('#mainContent'), grid=document.querySelector('#userCardsView');
      main.classList.add('chat-enabled');
      grid.style.maxHeight='300px';
      const cards=[...grid.querySelectorAll('.user-card')].map(card=>card.getBoundingClientRect());
      const bounds=main.getBoundingClientRect();
      return {width:innerWidth, scrollable:grid.scrollHeight>grid.clientHeight, columns:cards.filter(card=>card.top===cards[0].top).length,
        cardsFit:cards.every(card=>card.left>=bounds.left&&card.right<=bounds.right),
        toggleVisible:document.querySelector('#btnToggleMembers').getBoundingClientRect().right<=bounds.right};
    })()`);
    assert.ok(Math.abs(compact.width-COMPACT_WINDOW_WIDTH)<=1,"Windows may round the compact width by one pixel");
    assert.ok(compact.scrollable&&compact.columns===2&&compact.cardsFit&&compact.toggleVisible,JSON.stringify(compact));
    await run(`document.querySelector('#btnToggleMembers').click()`);
    assert.deepEqual(win.getMinimumSize(),[MIN_WINDOW_WIDTH,MIN_WINDOW_HEIGHT]);
    assert.ok(Math.abs(win.getBounds().width-MIN_WINDOW_WIDTH)<=1);
    console.log('CARD_LAYOUT_OK',JSON.stringify(measurements));
  } catch(error) {console.error(error.stack);process.exitCode=1;}
  finally {win?.destroy();app.exit(process.exitCode||0);}
});
