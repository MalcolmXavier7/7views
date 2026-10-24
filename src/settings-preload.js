'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The control panel. `act` names an action main knows (see PANEL_ACTIONS in main.js); main checks every argument.
contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  onState: (cb) => ipcRenderer.on('panel-state', (_e, state) => cb(state)),
  act: (action, ...args) => ipcRenderer.send('panel:do', action, ...args),
  ask: (action, arg) => ipcRenderer.invoke('panel:ask', action, arg),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  importChrome: () => ipcRenderer.invoke('vault:import'),
  trashExport: () => ipcRenderer.invoke('vault:trash-export'),
  removeLogin: (id) => ipcRenderer.invoke('vault:remove', id),
  clearLogins: () => ipcRenderer.invoke('vault:clear'),
  openChromePasswords: () => ipcRenderer.invoke('vault:open-chrome'),
});
