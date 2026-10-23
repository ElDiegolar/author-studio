/**
 * Author Studio desktop shell. Runs the studio in-process on 127.0.0.1 (a random free port, never
 * reachable from the network) and shows it in a window. Novels live in Documents\Author Studio;
 * settings, the API key and the writer soul live in the app's data folder. Nothing is uploaded.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const userData = app.getPath('userData');
process.env.AUTHOR_SETTINGS ||= path.join(userData, 'settings.json');
process.env.AUTHOR_WRITER_HOME ||= path.join(userData, 'writers');
process.env.AUTHOR_CLAUDE_CONFIG_DIR ||= path.join(userData, 'claude');
process.env.AUTHOR_MCP_MAIN ||= path.join(__dirname, 'mcp.mjs').replace('app.asar', 'app.asar.unpacked');
const library = process.env.AUTHOR_LIBRARY || path.join(app.getPath('documents'), 'Author Studio');
// First run: write by hand until the writer chooses an AI in Settings (no surprise network calls, no broken buttons).
if (!fs.existsSync(process.env.AUTHOR_SETTINGS)) { try { fs.mkdirSync(path.dirname(process.env.AUTHOR_SETTINGS), { recursive: true }); fs.writeFileSync(process.env.AUTHOR_SETTINGS, JSON.stringify({ ai: { mode: 'none' } }, null, 2)); } catch { /* settings page still works */ } }
const stateFile = path.join(userData, 'state.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
const writeState = (patch) => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ ...readState(), ...patch }, null, 2)); } catch { /* not fatal */ } };

let win = null;
let origin = '';

function createWindow() {
  const s = readState();
  win = new BrowserWindow({
    width: s.bounds?.width ?? 1360, height: s.bounds?.height ?? 900, x: s.bounds?.x, y: s.bounds?.y,
    minWidth: 900, minHeight: 640, backgroundColor: '#050505', title: 'Author Studio', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const save = () => { if (!win.isMinimized()) writeState({ bounds: win.isMaximized() ? s.bounds : win.getBounds(), maximized: win.isMaximized() }); };
  win.on('close', save);
  // Links to the outside world open in the browser; the app never navigates away from itself.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${origin}/api/export/`)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff' } };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Exports: the system Save dialog opens in Documents, and the page is told where the file went.
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    item.once('done', (_d, state) => { if (state === 'completed' && win) win.webContents.send('saved', item.getSavePath()); });
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); } });
  void win.loadURL(origin);
}

ipcMain.handle('save-pdf', async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadURL(`${origin}/api/export/html?inline=1`);
    const title = (await w.webContents.executeJavaScript('document.title')) || 'Book';
    const pdf = await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:9px Georgia,serif;color:#555"><span class="pageNumber"></span></div>' });
    const { filePath, canceled } = await dialog.showSaveDialog(win, { title: 'Save the book as PDF', defaultPath: path.join(app.getPath('documents'), `${title.replace(/[\\/:*?"<>|]+/g, '')}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, pdf);
    return filePath;
  } finally { w.destroy(); }
});
ipcMain.handle('open-library', () => shell.openPath(library));

function menu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Open library folder', click: () => shell.openPath(library) }, { label: 'Open data folder', click: () => shell.openPath(userData) }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length && origin) createWindow(); });

app.whenReady().then(async () => {
  menu();
  try {
    const { createApp, serve } = await import(pathToFileURL(path.join(__dirname, 'server.mjs')).href);
    const last = readState().lastProject;
    const studio = await createApp({
      library, webDist: path.join(__dirname, 'web'),
      ...(last && fs.existsSync(path.join(last, 'project.json')) ? { project: last } : {}),
      // Folders open in Explorer/Finder with the file selected, the way the system does it.
      reveal: async (p) => { if (fs.statSync(p).isFile()) shell.showItemInFolder(p); else { const err = await shell.openPath(p); if (err) throw new Error(err); } },
      onOpen: (title, dir) => { writeState({ lastProject: dir }); win?.setTitle(`${title} · Author Studio`); },
    });
    await new Promise((resolve) => serve({ fetch: studio.fetch, port: 0, hostname: '127.0.0.1' }, (info) => { origin = `http://127.0.0.1:${info.port}`; resolve(); }));
    createWindow();
  } catch (e) {
    dialog.showErrorBox('Author Studio could not start', String(e && e.stack || e));
    app.quit();
  }
});
