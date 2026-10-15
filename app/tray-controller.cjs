function createTrayController({ Tray, Menu, nativeImage }, { getWindow, canClose, quit }) {
  // Draw the application's S in a small bitmap; no extra runtime image file.
  const pixels = Buffer.alloc(32 * 32 * 4);
  const glyph = ['01111', '11000', '11000', '01110', '00011', '00011', '11110'];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 > 15.5 ** 2) continue;
    const white = glyph[Math.floor((y - 5) / 3)]?.[Math.floor((x - 8) / 3)] === '1';
    const offset = (y * 32 + x) * 4;
    pixels[offset] = white ? 255 : 245; pixels[offset + 1] = white ? 255 : 87; pixels[offset + 2] = white ? 255 : 86; pixels[offset + 3] = 255;
  }
  const tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }));
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
