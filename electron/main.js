'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Single instance lock - the portable exe should not spawn duplicates
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.setName('Recall');
app.setPath('userData', path.join(app.getPath('appData'), 'Recall'));

// Rendering quality / performance flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized(), fullscreen: win.isFullScreen() }));
  } catch (e) { /* ignore */ }
}

function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    width: st.width || 1360,
    height: st.height || 860,
    x: st.x, y: st.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0d14',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'src', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
      webgl: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => {
    if (st.maximized) win.maximize();
    if (st.fullscreen) win.setFullScreen(true);
    win.show();
  });
  const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  win.on('enter-full-screen', () => send('win:state', { fullscreen: true }));
  win.on('leave-full-screen', () => send('win:state', { fullscreen: false }));
  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('close', saveWindowState);
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && input.control && input.shift) { win.webContents.toggleDevTools(); }
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { app.quit(); });

// ---- IPC: window controls ----
ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:maximize', () => { if (!win) return false; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('win:fullscreen', (e, v) => { if (!win) return false; win.setFullScreen(typeof v === 'boolean' ? v : !win.isFullScreen()); return win.isFullScreen(); });
ipcMain.handle('win:state', () => win ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } : {});
ipcMain.handle('win:devtools', () => win && win.webContents.toggleDevTools());
ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), platform: process.platform, electron: process.versions.electron, chrome: process.versions.chrome }));
ipcMain.handle('app:openPath', (e, p) => shell.openPath(p));
ipcMain.handle('app:showItem', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('app:zoom', (e, delta) => { const z = win.webContents.getZoomFactor(); const n = delta === 0 ? 1 : Math.min(2, Math.max(0.6, z + delta)); win.webContents.setZoomFactor(n); return n; });

// ---- IPC: files ----
ipcMain.handle('file:save', async (e, { defaultPath, filters, data, encoding }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  if (r.canceled || !r.filePath) return { canceled: true };
  let buf;
  if (encoding === 'base64') buf = Buffer.from(data, 'base64');
  else if (data instanceof Uint8Array) buf = Buffer.from(data);
  else buf = Buffer.from(String(data), 'utf8');
  fs.writeFileSync(r.filePath, buf);
  return { canceled: false, path: r.filePath };
});
ipcMain.handle('file:open', async (e, { filters, multiple, binary }) => {
  const r = await dialog.showOpenDialog(win, { filters, properties: ['openFile', ...(multiple ? ['multiSelections'] : [])] });
  if (r.canceled) return { canceled: true, files: [] };
  const files = r.filePaths.map(p => {
    const buf = fs.readFileSync(p);
    return { name: path.basename(p), path: p, size: buf.length, data: binary ? buf.toString('base64') : buf.toString('utf8') };
  });
  return { canceled: false, files };
});
ipcMain.handle('file:readPath', (e, { path: p, binary }) => {
  const buf = fs.readFileSync(p);
  return { name: path.basename(p), size: buf.length, data: binary ? buf.toString('base64') : buf.toString('utf8') };
});
// Automatic backups in userData/backups (kept to the newest 30)
ipcMain.handle('backup:write', (e, { name, data }) => {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  files.slice(30).forEach(x => { try { fs.unlinkSync(path.join(dir, x.f)); } catch (err) { /* ignore */ } });
  return p;
});
ipcMain.handle('backup:list', () => {
  const dir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { const s = fs.statSync(path.join(dir, f)); return { name: f, path: path.join(dir, f), size: s.size, time: s.mtimeMs }; }).sort((a, b) => b.time - a.time);
});
ipcMain.handle('backup:read', (e, p) => fs.readFileSync(p, 'utf8'));
ipcMain.handle('theme:native', () => nativeTheme.shouldUseDarkColors);
