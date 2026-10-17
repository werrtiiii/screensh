import type { BrowserWindow } from 'electron';
import { join } from 'node:path';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';
export const preloadPath = (_name: string): string => join(__dirname, '../preload/overlay.cjs');
export const loadPage = (win: BrowserWindow, _page: string): Promise<void> =>
  win.loadFile(join(__dirname, '../renderer/overlay/index.html'));
