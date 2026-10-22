/** The only bridge between the page and the machine: save a PDF, open the library folder. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('authorDesktop', {
  platform: process.platform,
  savePdf: () => ipcRenderer.invoke('save-pdf'),
  openLibrary: () => ipcRenderer.invoke('open-library'),
});
