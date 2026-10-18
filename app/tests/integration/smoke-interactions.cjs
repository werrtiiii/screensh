// Three real renderers and Socket.IO connections; native audio output needs listening verification.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'), assert = require('node:assert/strict');
const { createSignalingServer } = require('../../../server/server');
const root = path.resolve(__dirname, "../..");
app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, '.runtime-probe', 'interactions-' + process.pid));
app.on('window-all-closed', () => {});
ipcMain.handle('get-hardware-acceleration', () => false);
app.whenReady().then(async () => {
  const windows = [], { server, io } = createSignalingServer({ initialPeers: 'test.example:11010' });
  const run = (win, code) => win.webContents.executeJavaScript(code, true).catch(error => { throw Error(error.message + '\nScript: ' + code); });
  const wait = async (win, condition) => {
    for (let i = 0; i < 80; i++) { if (await run(win, condition)) return; await new Promise(r => setTimeout(r, 50)); }
    throw Error('Timeout: ' + condition);
  };
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    for (let i = 0; i < 3; i++) {
      const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { partition: `interaction-${process.pid}-${i}`, preload: path.join(root, 'preload.js'), backgroundThrottling: false } }); windows.push(win);
      await win.loadFile(path.join(root, 'renderer/index.html'));
      await run(win, `(async () => {
        await import('./renderer.js'); window.channelVoice.sync = () => {};
        window.interactionSounds = 0; const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { if(this.src.includes('/interactions/')) interactionSounds++; return play.call(this); };
        const signaling = await import('./signaling.js'), { state } = await import('./shared.js');
        document.querySelector('#serverUrl').value = 'http://127.0.0.1:${server.address().port}';
        const connection = signaling.connectServer(); await new Promise(r => connection.once('connect',r));
        const joined = await signaling.requestServer('join-server', { userName: 'Interaction ${i}', virtualIp: '10.144.8.${i+1}', identity: '${String(i + 1).repeat(64)}', easytierPeers: ['tcp://test.example:11010'] });
        state.roomId = joined.serverId; state.channelId = 'main';
        document.querySelector('#lobby').classList.remove('active'); document.querySelector('#room').classList.add('active');
        signaling.applyServerState(joined);
      })()`);
    }
    const [a, b, c] = windows;
    const adminId = await run(c, `(async () => (await import('./signaling.js')).socket.id)()`);
    await run(a, `(async () => (await import('./signaling.js')).requestServer('set-admin', {socketId:'${adminId}',enabled:true}))()`);
    await wait(b, `document.querySelector('#userList').children[1]?.textContent.includes('Interaction 2')`);
    for (const win of windows) assert.equal(await run(win, `(async () => document.querySelector('.user-card').dataset.userId === (await import('./signaling.js')).socket.id)()`), true);
    await wait(a, `document.querySelectorAll('.interaction-trigger').length === 2`);
    const target = await run(b, `(async () => (await import('./signaling.js')).socket.id)()`);
    await run(a, `document.querySelector('[data-user-id="${target}"] .interaction-trigger').click()`);
    assert.equal(await run(a, `document.querySelectorAll('.interaction-choice').length`), 9);
    a.show(); await new Promise(r => setTimeout(r, 250));
    require('node:fs').writeFileSync(path.join(root, '.runtime-probe', 'interactions-picker.png'), (await a.webContents.capturePage()).toPNG());
    assert.equal(await run(a, `(() => { const r=document.querySelector('.interaction-picker').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight; })()`), true);
    await run(a, `document.querySelector('.interaction-choice[aria-label="炸弹"]').click()`);
    for (const win of windows) await wait(win, `document.querySelector('[data-user-id="${target}"] .interaction-animation')?.naturalWidth > 0`);
    await wait(a, 'interactionSounds === 1'); await wait(b, 'interactionSounds === 1');
    assert.equal(await run(c, 'interactionSounds'), 0);
    assert.equal(await run(a, `!!document.querySelector('.interaction-picker') && [...document.querySelectorAll('.interaction-choice')].every(b=>!b.disabled)`), true);
    await run(a, `for(let i=0;i<10;i++) document.querySelector('.interaction-choice[aria-label="炸弹"]').click()`);
    assert.equal(await run(a, `interactionSounds`), 1, 'rapid clicks are allowed but have no extra effect');
    await run(b, `(async () => { window.effectBefore = document.querySelector('.interaction-animation'); const s=await import('./signaling.js');s.applyServerState(await s.requestServer('switch-channel',{channelId:'main'})); })()`);
    assert.equal(await run(b, `effectBefore === document.querySelector('.interaction-animation')`), true);
    assert.equal(await run(a, `!!document.querySelector('.interaction-picker')`), true, 'member updates must not dismiss picker');
    await new Promise(r => setTimeout(r, 1100));
    await run(a, `document.querySelector('.interaction-choice[aria-label="爱心"]').click()`);
    await wait(a, 'interactionSounds === 2'); await wait(b, 'interactionSounds === 2');
    assert.equal(await run(a, `!!document.querySelector('.interaction-picker')`), true);
    await run(b, `(async () => { const s=await import('./signaling.js'); await s.requestServer('start-sharing'); })()`);
    await wait(a, `!document.querySelector('[data-user-id="${target}"] .interaction-trigger')`);
    assert.equal(await run(a, `document.querySelectorAll('.interaction-picker').length`), 0, 'sharing hides trigger and closes its picker');
    await run(b, `(async () => { const s=await import('./signaling.js'); await s.requestServer('stop-sharing'); })()`);
    await wait(a, `!!document.querySelector('[data-user-id="${target}"] .interaction-trigger')`);
    await run(b, `(async () => (await import('./signaling.js')).disconnectSignaling())()`);
    assert.equal(await run(b, `document.querySelectorAll('.interaction-animation').length`), 0);
    await run(a, `document.querySelector('.interaction-trigger').click(); window.dispatchEvent(new Event('resize'));`);
    assert.equal(await run(a, `document.querySelectorAll('.interaction-picker').length`), 1);
    await run(a, `document.querySelector('#channelNameDisplay').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
    assert.equal(await run(a, `document.querySelectorAll('.interaction-picker').length`), 0);
    await new Promise(r => setTimeout(r, 6500));
    assert.equal(await run(a, `document.querySelectorAll('.interaction-animation, .interaction-badge').length`), 0);
    const preview = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } }); windows.push(preview);
    await preview.loadFile(path.join(root, 'tools/interaction-audio-preview.html'));
    await wait(preview, `[...document.querySelectorAll('audio')].length===9 && [...document.querySelectorAll('audio')].every(a=>Number.isFinite(a.duration) && a.duration>0)`);
    assert.equal(await run(preview, `(() => { const s=document.querySelector('select');s.value='炸弹';s.dispatchEvent(new Event('change'));return document.querySelector('#result').value.split(String.fromCharCode(10))[0]; })()`), '音效 1 → 炸弹');
    console.log('INTERACTIONS_OK', JSON.stringify({ picker: true, animationOnAllThree: true, soundsOnlyForParticipants: true, cooldown: true, effectSurvivesRender: true, cleanup: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { windows.forEach(win => win.destroy()); await new Promise(r => io.close(r)); app.exit(process.exitCode || 0); }
});
