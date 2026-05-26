const { app, BrowserWindow, desktopCapturer, ipcMain, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let audioCaptureProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ScreenSh - 屏幕共享',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC Handlers ---

ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('get-source-by-id', async (_event, sourceId) => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
  });
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return null;
  return {
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  };
});

// ============================================================
// 单独窗口音频捕获管道控制 (方案 B)
// ============================================================
ipcMain.on('start-window-audio-capture', (event, sourceId) => {
  if (audioCaptureProcess) {
    audioCaptureProcess.kill();
    audioCaptureProcess = null;
  }

  const parts = sourceId.split(':');
  if (parts[0] !== 'window') return;

  const hwndStr = parts[1]; 
  
  const exePath = app.isPackaged 
  ? path.join(process.resourcesPath, 'app-audio-capturer.exe') 
  : path.join(__dirname, 'app-audio-capturer.exe');

  audioCaptureProcess = spawn(exePath, [hwndStr]);

  audioCaptureProcess.stdout.on('data', (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-audio-data', chunk);
    }
  });

  audioCaptureProcess.stderr.on('data', (data) => {
    console.log(`[后台 EXE 输出]: ${data}`);
  });

  audioCaptureProcess.on('close', (code) => {
    console.log(`[后台 EXE 退出] Code: ${code}`);
    audioCaptureProcess = null;
  });
});

ipcMain.on('stop-window-audio-capture', () => {
  if (audioCaptureProcess) {
    audioCaptureProcess.kill();
    audioCaptureProcess = null;
  }
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

app.whenReady().then(() => {
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (audioCaptureProcess) audioCaptureProcess.kill();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
