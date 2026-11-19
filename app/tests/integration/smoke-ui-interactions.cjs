const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const assert = require('assert/strict');
const fs = require('fs');
const root = path.resolve(__dirname, '../..');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, '.runtime-probe', `ui-interactions-${process.pid}`));
app.on('window-all-closed', () => {});
const acceleration = { enabled: true, source: 'https://gh-proxy.com', customUrl: '', sources: ['https://gh-proxy.com'] };
for (const [name, value] of Object.entries({
  'get-hardware-acceleration': false, 'get-login-startup': false,
  'lolping-get': { config: { enabled: false } }, 'lolping-sync': null,
  'get-update-settings': { enabled: true, status: 'current', currentVersion: '1.5.7' },
  'get-update-acceleration': acceleration, 'confirm-startup': null,
  'get-easytier-settings': {}, 'stop-sharing': null, 'leave-runtime': null,
  'voice-stop': true, 'set-voice-timing': null,
})) ipcMain.handle(name, () => value);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 960, height: 640, frame: false, show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
  const run = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const pause = () => new Promise(resolve => setTimeout(resolve, 70));
  try {
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await run(`await import("./renderer.js")`);
    assert.equal(await run(`return !document.querySelector("#btnAddFirstBookmark")?.hidden && document.querySelector("#bookmarkSearchCount").hidden`), true, "empty lobby offers an add action");
    await run(`document.querySelector("#btnAddFirstBookmark").click()`);
    assert.equal(await run(`return document.activeElement.id === "bookmarkUrlInput"`), true, "empty-state action opens the existing bookmark form");
    await run(`localStorage.setItem('serverBookmarks',JSON.stringify([{name:'工作服务器',url:'http://127.0.0.1:34561'},{name:'游戏服务器',url:'http://127.0.0.1:34562'}]));`);
    await win.reload();
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await run(`await import('./renderer.js');`);
    assert.equal(await run(`
      const add=document.querySelector('#btnAddBookmark'),collapse=document.querySelector('#btnCollapseBookmarks');
      const a=add.getBoundingClientRect(),b=collapse.getBoundingClientRect();
      return !!add.querySelector('svg')&&!!collapse.querySelector('svg')&&a.top===b.top&&a.height===b.height;
    `),true,'bookmark header actions use equal-size line icons');
    assert.equal(await run(`
      const collapse=document.querySelector('#btnCollapseBookmarks'),list=document.querySelector('#bookmarkList');
      collapse.click();
      const hidden=list.classList.contains('collapsed')&&collapse.getAttribute('aria-expanded')==='false'&&localStorage.getItem('bookmarksCollapsed')==='true';
      collapse.click();
      return hidden&&!list.classList.contains('collapsed')&&collapse.getAttribute('aria-expanded')==='true';
    `),true,'bookmark action toggles the list and its expanded state');
    assert.equal(await run(`const input=document.querySelector('#serverSearch');input.value='不存在';input.dispatchEvent(new Event('input'));return [...document.querySelectorAll('#bookmarkList .bookmark-item')].every(n=>n.getBoundingClientRect().height===0);`), true, 'nonmatching bookmarks must be visually hidden');
    assert.equal(await run(`return document.querySelector('#bookmarkSearchEmpty')?.textContent;`), '没有匹配的服务器');
    await run(`document.querySelector('#btnClearServerSearch').click();`);
    assert.equal(await run(`return document.activeElement.id==='serverSearch'&&[...document.querySelectorAll('#bookmarkList .bookmark-item')].filter(n=>n.getBoundingClientRect().height>0).length===2;`), true);
    assert.equal(await run(`const i=document.querySelector('#serverSearch');i.value='34562';i.dispatchEvent(new Event('input'));document.dispatchEvent(new CustomEvent('server-bookmark-updated',{detail:{url:'http://127.0.0.1:34561',name:'新名称'}}));return [...document.querySelectorAll('#bookmarkList .bookmark-item')].filter(n=>n.getBoundingClientRect().height>0).length;`), 1, 'refresh must retain filtering');
    await run(`document.querySelector('#btnSettings').focus();document.querySelector('#btnSettings').click();`);
    assert.deepEqual(await run(`return [...document.querySelectorAll('.settings-navigation button')].map(button=>button.textContent);`), ['常规','lolPing','EasyTier','聊天记录','语音','屏幕共享','个人资料']);
    assert.equal(await run(`return !!document.querySelector('#settings-panel-general .setting-update') && !!document.querySelector('#settings-panel-general .setting-sounds');`),true,'updates and sounds belong to General');
    assert.deepEqual(await run(`return [...document.querySelectorAll('#settings-panel-general .settings-group-title')].map(node=>node.textContent)`), ['外观','启动','更新','音效']);
    assert.equal(await run(`return document.querySelector('.glass-transparency-actions').contains(document.querySelector('#btnResetGlassTransparency'))`), true, 'transparency reset sits beside the numeric value');
    await pause();
    assert.equal(await run(`return document.querySelector('#settingsModal').contains(document.activeElement);`), true, 'modal initial focus');
    assert.equal(await run(`return document.querySelector('#updateAcceleration').getBoundingClientRect().height>0;`), true, 'general includes update controls');
    await run(`document.querySelector('[role=tab][data-category=voice]').click();`);
    assert.equal(await run(`return document.querySelector('[data-select-for="voiceMicrophone"]').getBoundingClientRect().height>0&&document.querySelector('#chatCacheClearAll').getBoundingClientRect().height===0&&document.querySelectorAll('#settingsModal .modal-body > .settings-panel:not([hidden])').length===1;`), true, 'only selected category visible');
    await run(`document.querySelector('[role=tab][data-category=chat]').click();document.querySelector('#chatCacheDays').value=47;document.querySelector('[role=tab][data-category=voice]').click();document.querySelector('[role=tab][data-category=chat]').click();`);
    assert.equal(await run(`return document.querySelector('#chatCacheDays').value;`), '47', 'tab changes preserve drafts');
    await run(`document.querySelector('[role=tab][data-category=general]').click();`);
    assert.equal(await run(`return document.querySelector('#updateAccelerationDetails').open;`), false);
    win.webContents.debugger.attach('1.3');
    async function key(key, code=key, modifiers=0) {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type:'keyDown',key,code,modifiers,text:key==='Enter'?'\r':undefined,windowsVirtualKeyCode: {Tab:9,Enter:13,Escape:27}[key]||0 });
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type:'keyUp',key,code,modifiers });
      await pause();
    }
    await run(`window.updateBeforeHelp=document.querySelector('#autoUpdateCheckbox').checked;document.querySelector('#autoUpdateCheckbox').closest('label').querySelector('.help-tip').click();`);
    assert.equal(await run(`const tip=document.querySelector('#appHelpTooltip'),rect=tip?.getBoundingClientRect();return !!tip&&rect.left>=0&&rect.right<=innerWidth&&rect.top>=38&&rect.bottom<=innerHeight&&document.querySelector('#autoUpdateCheckbox').checked===window.updateBeforeHelp;`),true,'help stays in the viewport and never toggles its setting');
    await key('Escape');
    assert.equal(await run(`return !document.querySelector('#appHelpTooltip')&&!document.querySelector('#settingsModal').classList.contains('hidden');`),true,'Escape dismisses help before its dialog');
    await key('Enter');
    assert.equal(await run(`return !!document.querySelector('#appHelpTooltip');`),true,'keyboard opens a focused help control');
    await key('Escape');
    await run(`document.querySelector('#softwareSoundVolume').focus();`);
    await key('Tab');
    assert.equal(await run(`return document.activeElement.id;`), 'btnCloseSettings', 'Tab wraps to first control');
    await key('Tab','Tab',8);
    assert.equal(await run(`return document.activeElement.id;`), 'softwareSoundVolume', 'Shift Tab wraps to last control');
    await key('Escape');
    assert.equal(await run(`return document.querySelector('#settingsModal').classList.contains('hidden')&&document.activeElement.id==='btnSettings';`), true, 'Escape and focus restoration');
    await run(`document.querySelector('#btnSettings').click();document.querySelector('[data-category=network]').click();`);
    await pause();
    await run(`document.querySelector('#btnEasyTierAdvanced').focus();document.querySelector('#btnEasyTierAdvanced').click();`);
    await pause();
    assert.equal(await run(`return document.querySelector('#easyTierSettingsDialog').contains(document.activeElement);`), true, 'nested dialog takes focus');
    await key('Escape');
    assert.equal(await run(`return document.querySelector('#easyTierSettingsDialog').classList.contains('hidden')&&!document.querySelector('#settingsModal').classList.contains('hidden')&&document.activeElement.id==='btnEasyTierAdvanced';`), true, 'Escape closes only top dialog and restores its opener');
    await key('Escape');
    await run(`const bookmark=document.querySelector('#bookmarkList .bookmark-item:not([hidden])');bookmark.focus();bookmark.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));document.querySelector('.context-menu button').click();`);
    await pause();
    await key('Escape');
    assert.equal(await run(`return document.activeElement.matches('#bookmarkList .bookmark-item');`), true, 'context-menu dialog restores durable bookmark trigger');
    await run(`window.passwordResult='pending';const {requestPassword}=await import('./password-dialog.js');requestPassword().then(value=>window.passwordResult=value);`);
    await pause();
    await run(`const i=document.querySelector('#serverPasswordInput');i.value='中文密码';i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));`);
    await key('Enter');
    assert.equal(await run(`return window.passwordResult;`), 'pending', 'IME Enter must not submit');
    await run(`document.querySelector('#serverPasswordInput').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`);
    await key('Enter');
    assert.equal(await run(`return window.passwordResult.password;`), '中文密码', 'native Enter submits password');
    await run(`window.submitCount=0;document.querySelector('#serverConnectForm').addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();window.submitCount++;},true);document.querySelector('#serverUrl').focus();`);
    await key('Enter');
    assert.equal(await run(`return window.submitCount;`), 1, 'address Enter submits once');
    await run(`document.querySelector('#btnRoomSettingsToolbar').click();`);
    assert.equal(await run(`return !!document.querySelector('[data-select-for="videoEncoderSelect"]');`),true,'settings use the shared styled select');
    await run(`window.encoderChanges=0;document.querySelector('#videoEncoderSelect').addEventListener('change',()=>window.encoderChanges++);document.querySelector('[data-select-for="videoEncoderSelect"]').click();`);
    assert.equal(await run(`return document.querySelectorAll('.select-popup:not([inert]) [role=option]').length;`),4,'popup exposes all encoder options');
    await key('End');await key('Enter');
    assert.equal(await run(`return document.querySelector('#videoEncoderSelect').value==='amf'&&localStorage.getItem('videoEncoder')==='amf'&&window.encoderChanges===1&&!document.querySelector('.select-popup:not([inert])');`),true,'keyboard selection commits once through the existing setting');
    await run(`document.querySelector('[data-select-for="videoEncoderSelect"]').click();`);
    await key('Escape');
    assert.equal(await run(`return !!document.querySelector('.select-popup[inert]')?.getAnimations().some(motion=>motion.effect.getTiming().duration===120)`),true,'closed dropdown is inert during its short exit');
    assert.equal(await run(`return !document.querySelector('.select-popup:not([inert])')&&!document.querySelector('#settingsModal').classList.contains('hidden')&&document.activeElement.dataset.selectFor==='videoEncoderSelect';`),true,'Escape closes the picker before the modal');
    await run(`document.querySelector('#videoEncoderSelect').options[3].disabled=true;`);await pause();
    await run(`document.querySelector('[data-select-for="videoEncoderSelect"]').click();`);
    await key('End');await key('Enter');
    assert.equal(await run(`return document.querySelector('#videoEncoderSelect').value;`),'qsv','keyboard skips disabled options');
    await run(`document.querySelector('#videoEncoderSelect').disabled=true;`);await pause();
    assert.equal(await run(`return document.querySelector('[data-select-for="videoEncoderSelect"]').disabled;`),true,'native disabled state is mirrored');
    await run(`document.querySelector('#videoEncoderSelect').disabled=false;`);
    await run(`document.querySelector('#btnCloseSettings').click();document.querySelector('#btnSettings').click();document.querySelector('[role=tab][data-category=voice]').click();document.querySelector('#voiceMicrophone').add(new Option('USB 测试麦克风','usb-test'));`);
    await pause();
    await run(`document.querySelector('[data-select-for="voiceMicrophone"]').click();`);
    assert.equal(await run(`return [...document.querySelectorAll('.select-popup:not([inert]) [role=option]')].some(node=>node.textContent.includes('USB 测试麦克风'));`),true,'dynamic device options appear in the styled picker');
    await key('u');
    assert.equal(await run(`return document.querySelector('.select-popup:not([inert]) .select-option[data-active]').textContent;`),'USB 测试麦克风','typeahead highlights matching options');
    await key('Escape');
    await pause();
    await run(`const label=document.createElement('label');label.id='implicitSelectFixture';label.textContent='连接模式';const select=document.createElement('select');select.id='implicitSelectFixtureSource';select.append(new Option('自动连接','auto'),new Option('手动连接','manual'));label.append(select);document.querySelector('.setting-voice').append(label);`);
    await pause();
    assert.equal(await run(`return document.querySelector('[data-select-for="implicitSelectFixtureSource"]').getAttribute('aria-label');`),'连接模式','implicit labels do not include option text');
    await run(`document.querySelector('#implicitSelectFixture').remove();`);
    const out = path.join(root, '.runtime-probe', 'ui-interactions');fs.mkdirSync(out,{recursive:true});
    win.showInactive();await new Promise(resolve=>setTimeout(resolve,300));
    fs.writeFileSync(path.join(out,'settings-voice-light.png'),(await win.webContents.capturePage()).toPNG());
    await run(`document.documentElement.dataset.theme='dark';document.querySelector('[role=tab][data-category=general]').click();`);
    await new Promise(resolve=>setTimeout(resolve,260));
    fs.writeFileSync(path.join(out,'settings-update-dark.png'),(await win.webContents.capturePage()).toPNG());
    console.log('UI_INTERACTIONS_OK search, panels, focus, Tab, Escape, IME and native Enter at 960x640');
    app.exit(0);
  } catch(error) { console.error(error);app.exit(1); }
});
