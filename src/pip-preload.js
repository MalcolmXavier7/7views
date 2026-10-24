'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The bar on a picture-in-picture window. Every call acts on that window's own screen; main works out which.
contextBridge.exposeInMainWorld('pip', {
  onState: (cb) => ipcRenderer.on('pip-state', (_e, state) => cb(state)),
  ready: () => ipcRenderer.send('pip:ready'),
  setMuted: (muted) => ipcRenderer.send('pip:mute', muted),
  setFit: (mode) => ipcRenderer.send('pip:fit', mode),
  back: () => ipcRenderer.send('pip:back'),
  drag: (on) => ipcRenderer.send('pip:drag', on),
});
