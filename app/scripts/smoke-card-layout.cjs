const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration(); app.setPath('userData', path.join(root, '.runtime-probe', 'card-layout-' + process.pid));
app.on('window-all-closed', () => {}); ipcMain.handle('get-hardware-acceleration', () => false);
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, frame: false, width: 960, height: 640, minWidth: 960, minHeight: 640, webPreferences: { preload: path.join(root,'preload.js'), backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    await win.loadFile(path.join(root,'renderer/index.html'));
    await run(`(async()=>{ await import('./renderer.js'); const {state}=await import('./shared.js'); state.roomId='layout';state.channelId='main';state.channels=[{id:'main',name:'主频道'}];
      const users=Array.from({length:4},(_,i)=>({socketId:i===0?undefined:'user-'+i,name:i===0?'自己':'成员 '+i,role:i===0?'host':'member',channelId:'main',voiceEnabled:true}));state.serverUsers=users;
      document.querySelector('#lobby').classList.remove('active');document.querySelector('#room').classList.add('active');(await import('./room.js')).updateUserList(users); })()`);
    const measurements=[];
    for(const [width,height] of [[960,640],[1200,720],[1440,900],[1600,1000],[1920,1080]]) {
      win.setSize(width,height); await new Promise(r=>setTimeout(r,300));
      const result=await run(`(()=>{const box=document.querySelector('#mainContent').getBoundingClientRect();const cards=[...document.querySelectorAll('.user-card')].map(c=>{const r=c.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}});return {width:innerWidth,height:innerHeight,viewport:{left:box.left,top:box.top,right:box.right,bottom:box.bottom},cards,scrollWidth:document.querySelector('#mainContent').scrollWidth,clientWidth:document.querySelector('#mainContent').clientWidth};})()`);
      assert.equal(result.cards.length,4);assert.ok(result.scrollWidth<=result.clientWidth,'no horizontal overflow');
      for(const card of result.cards) {assert.ok(card.right<=result.viewport.right && card.left>=result.viewport.left);assert.ok(card.bottom<=result.viewport.bottom,'four cards must be fully visible');assert.ok(card.width<=320,'cards keep a maximum width');}
      assert.equal(await run(`document.querySelector('.room-sidebar').getBoundingClientRect().width`),238);
      assert.equal(await run(`getComputedStyle(document.querySelector('#mainContent')).paddingLeft`),'12px');
      assert.equal(await run(`getComputedStyle(document.querySelector('.cards-grid')).gap`),'16px');
      if(width===960) {assert.equal(result.cards.filter(c=>Math.abs(c.top-result.cards[0].top)<1).length,2);assert.ok(result.cards[2].top>result.cards[0].top);assert.ok(Math.abs((result.cards[0].left-result.viewport.left)-(result.viewport.right-result.cards[1].right))<1,'minimum layout has equal left and right padding');win.show();await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(root,'.runtime-probe','cards-minimum.png'),(await win.webContents.capturePage()).toPNG());}
      measurements.push({window:[result.width,result.height],card:[result.cards[0].width,result.cards[0].height]});
    }
    assert.ok(measurements[3].card[0]>measurements[0].card[0]);assert.ok(measurements[3].card[1]>measurements[0].card[1]);
    const mainSource=fs.readFileSync(path.join(root,'main.js'),'utf8');assert.match(mainSource,/minWidth: 960, minHeight: 640/);
    console.log('CARD_LAYOUT_OK',JSON.stringify(measurements));
  } catch(error) {console.error(error.stack);process.exitCode=1;}
  finally {win?.destroy();app.exit(process.exitCode||0);}
});
