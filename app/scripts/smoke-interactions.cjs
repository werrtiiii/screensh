// Three real renderers and Socket.IO connections; native audio output needs listening verification.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'), assert = require('node:assert/strict');
const { createSignalingServer } = require('../../server/server');
const root = path.resolve(__dirname, '..');
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
    assert.equal(await run(a, `[...document.querySelectorAll('.interaction-trigger')].every(b=>b.disabled)`), true);
    await run(b, `(async () => { window.effectBefore = document.querySelector('.interaction-animation'); const s=await import('./signaling.js');s.applyServerState(await s.requestServer('switch-channel',{channelId:'main'})); })()`);
    assert.equal(await run(b, `effectBefore === document.querySelector('.interaction-animation')`), true);
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(await run(a, `[...document.querySelectorAll('.interaction-trigger')].every(b=>!b.disabled)`), true);
    await run(b, `(async () => (await import('./signaling.js')).disconnectSignaling())()`);
    assert.equal(await run(b, `document.querySelectorAll('.interaction-animation').length`), 0);
    await run(a, `document.querySelector('.interaction-trigger').click(); window.dispatchEvent(new Event('resize'));`);
    assert.equal(await run(a, `document.querySelectorAll('.interaction-picker').length`), 0);
    await new Promise(r => setTimeout(r, 6100));
    assert.equal(await run(a, `document.querySelectorAll('.interaction-animation, .interaction-badge').length`), 0);
    console.log('INTERACTIONS_OK', JSON.stringify({ picker: true, animationOnAllThree: true, soundsOnlyForParticipants: true, cooldown: true, effectSurvivesRender: true, cleanup: true }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { windows.forEach(win => win.destroy()); await new Promise(r => io.close(r)); app.exit(process.exitCode || 0); }
});
