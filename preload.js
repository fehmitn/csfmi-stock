'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  request: (action, payload) => ipcRenderer.invoke('db:request', { action, payload }),
  generatePdf: (opts) => ipcRenderer.invoke('pdf:generate', opts),
  exportCsv: (opts) => ipcRenderer.invoke('csv:export', opts)
});
