const path = require('node:path');
function createTrayController({ Tray, Menu, nativeImage }, { getWindow, canClose, quit }) {
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../assets/branding/tray.png')));
  const show = () => {
    const win = getWindow(); if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore(); win.show(); win.focus();
  };
  tray.setToolTip('ScreenSh');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 ScreenSh', click: show }, { type: 'separator' }, { label: '退出', click: quit }]));
  tray.on('click', show); tray.on('double-click', show);
  return {
    show,
    attach(win) { win.on('close', event => { if (!canClose() && !tray.isDestroyed()) { event.preventDefault(); win.hide(); } }); },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
module.exports = { createTrayController };
