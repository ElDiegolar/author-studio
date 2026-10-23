/** The only bridge between the page and the machine: save a PDF, open the library folder, hear where an export was saved. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('authorDesktop', {
  platform: process.platform,
  savePdf: () => ipcRenderer.invoke('save-pdf'),
  openLibrary: () => ipcRenderer.invoke('open-library'),
  onSaved: (cb) => { ipcRenderer.on('saved', (_e, p) => cb(p)); },
});
