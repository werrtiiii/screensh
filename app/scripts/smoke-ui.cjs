// Exercises the real renderer against a real signaling server. Native capture is mocked.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const assert = require('assert/strict');
const { createSignalingServer } = require('../../server/server');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, '.runtime-probe', `ui-${process.pid}`));
app.on('window-all-closed', () => {});
let stops = 0, captureConfig, attempts = 0, networkPeers;
ipcMain.handle('start-easytier', (_event, _roomId, peers) => { networkPeers = peers; return '10.144.1.1'; });
ipcMain.handle('get-screens', () => [{ id: 'window-test', type: 'window', name: 'Test window' }]);
ipcMain.handle('start-sharing', (_event, config) => {
  captureConfig = config;
  if (++attempts === 1) throw new Error('Synthetic startup failure');
  return { width: 1280, height: 720 };
});
ipcMain.handle('stop-sharing', () => { stops++; });
ipcMain.handle('leave-runtime', () => {});
ipcMain.handle('test-easytier-peer', (_event, peer) => {
  assert.equal(peer, 'tcp://example.com:11010');
  return { peer, elapsedMs: 1200 };
});
app.whenReady().then(async () => {
  const { server, io } = createSignalingServer();
  let window;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('RENDERER', message); });
    await window.loadFile(path.join(root, 'renderer/index.html'));
    const saved = await window.webContents.executeJavaScript(`(async () => {
      await import('./renderer.js');
      document.querySelector('#btnSettings').click();
      const testInput = document.querySelector('#peerTestInput');
      testInput.value = 'example.com:11010';
      document.querySelector('#btnTestPeer').click();
      for (let i = 0; i < 100 && document.querySelector('#btnTestPeer').disabled; i++) await new Promise(r => setTimeout(r, 20));
      if (!document.querySelector('#peerTestResult').textContent.includes('握手成功')) throw new Error('Peer test result missing');
      const input = document.querySelector('#easytierPeers');
      input.value = 'hhh.591.world:11010\\nudp://127.0.0.1:11011';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const captureMethod = document.querySelector('#captureMethodSelect');
      captureMethod.value = 'wgc';
      captureMethod.dispatchEvent(new Event('change', { bubbles: true }));
      const encoder = document.querySelector('#videoEncoderSelect');
      encoder.value = 'amf'; encoder.dispatchEvent(new Event('change', { bubbles: true }));
      return { stored: localStorage.getItem('easytierPeers'), error: document.querySelector('#easytierPeersError').textContent };
    })()`);
    assert.equal(saved.stored, 'hhh.591.world:11010\nudp://127.0.0.1:11011');
    assert.equal(saved.error, '');
    assert.equal(networkPeers, undefined, 'Enter in settings must not join a room');
    window.destroy();
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(path.join(root, 'renderer/index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      await import('./renderer.js');
      const $ = s => document.querySelector(s);
      const peersRestored = $('#easytierPeers').value === 'hhh.591.world:11010\\nudp://127.0.0.1:11011';
      if ($('#captureMethodSelect').value !== 'wgc') throw new Error('Capture method not restored');
      if ($('#videoEncoderSelect').value !== 'amf') throw new Error('Encoder not restored');
      async function until(fn) { for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50))}throw new Error('UI timeout: ' + fn.toString()) }
      $('#serverUrl').value = 'http://127.0.0.1:${server.address().port}';
      $('#createRoomId').value = 'smoke'; $('#btnCreate').click();
      await until(() => $('#room').classList.contains('active'));
      await until(() => $('#userCount').textContent === '1');
      $('#btnShare').click(); await until(() => $('.screen-item')); $('.screen-item').click(); $('#btnConfirmShare').click();
      await until(() => !$('#btnConfirmShare').disabled);
      const failedCleanly = $('#btnStopShare').classList.contains('hidden');
      const { WhepSession } = await import('./whep.mjs');
      let previewUrl;
      WhepSession.prototype.start = async function () { previewUrl = this.url; };
      $('#btnConfirmShare').click();
      await until(() => $('#videoContainer video'));
      const autoPreview = $('#watchingUserName').textContent === '我的共享预览'
        && $('#videoContainer video').muted && previewUrl === 'http://127.0.0.1:8889/live/whep';
      $('.video-debug-button').click();
      await until(() => $('#videoDebugPanel').textContent.includes('等待视频数据'));
      if ($('.video-debug-button').getAttribute('aria-expanded') !== 'true') throw new Error('Debug panel did not open');
      $('.video-debug-button').click();
      if (!$('#videoDebugPanel').classList.contains('hidden')) throw new Error('Debug panel did not close');
      const { attachVideoStats } = await import('./video-stats.mjs');
      const probe = document.createElement('div'); document.body.append(probe);
      let tick = 0;
      const disposeProbe = attachVideoStats(probe, { getStats: async () => new Map([['v', {
        id: 'v', type: 'inbound-rtp', kind: 'video', timestamp: ++tick * 1000,
        framesDecoded: 30, bytesReceived: 1000, jitterBufferEmittedCount: 30,
        jitterBufferDelay: 1, totalDecodeTime: 0.1
      }]]) });
      probe.querySelector('button').click();
      await until(() => probe.querySelector('.is-abnormal')?.textContent.includes('暂停估算'));
      if (!probe.querySelector('.is-abnormal')?.textContent.includes('⚠')) throw new Error('Missing abnormal warning');
      disposeProbe(); probe.remove();
      $('#btnStopWatch').click();
      const keepsSharing = !$('#btnStopShare').classList.contains('hidden')
        && !$('#userCardsView').classList.contains('hidden') && !$('#videoContainer video');
      const media = await import('./media.js');
      await media.stopSharing();
      $('#autoPreviewCheckbox').checked = false;
      $('#autoPreviewCheckbox').dispatchEvent(new Event('change', { bubbles: true }));
      $('#btnShare').click(); await until(() => $('.screen-item')); $('.screen-item').click(); $('#btnConfirmShare').click();
      await until(() => !$('#btnConfirmShare').disabled);
      if ($('#btnStopShare').classList.contains('hidden') || $('#videoContainer video')) throw new Error('Disabling automatic preview must keep sharing without a receiver');
      if (localStorage.getItem('autoPreview') !== 'false') throw new Error('Preview preference not saved');
      $('#btnLeave').click(); await until(() => $('#lobby').classList.contains('active'));
      return { failedCleanly, autoPreview, keepsSharing, peersRestored, roomId: $('#roomIdDisplay').textContent, ioLoaded: typeof io === 'function' };
    })()`);
    assert.equal(result.failedCleanly, true); assert.equal(result.ioLoaded, true); assert.equal(result.roomId, 'smoke');
    assert.ok(stops > 0);
    assert.equal(result.peersRestored, true);
    assert.deepEqual(networkPeers, ['tcp://hhh.591.world:11010', 'udp://127.0.0.1:11011']);
    assert.equal(result.autoPreview, true);
    assert.equal(result.keepsSharing, true);
    assert.equal(captureConfig.sourceType, 'window');
    assert.equal(captureConfig.captureMethod, 'wgc');
    assert.equal(captureConfig.videoEncoder, 'amf');
    assert.equal(captureConfig.sourceId, 'window-test');
    console.log('UI_SMOKE_OK', JSON.stringify(result));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { window?.destroy(); await new Promise(resolve => io.close(resolve)); app.exit(process.exitCode || 0); }
});

