'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recallNative', {
  isElectron: true,
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  fullscreen: (v) => ipcRenderer.invoke('win:fullscreen', v),
  windowState: () => ipcRenderer.invoke('win:state'),
  devtools: () => ipcRenderer.invoke('win:devtools'),
  onWindowState: (cb) => ipcRenderer.on('win:state', (e, v) => cb(v)),
  info: () => ipcRenderer.invoke('app:info'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  showItem: (p) => ipcRenderer.invoke('app:showItem', p),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  zoom: (d) => ipcRenderer.invoke('app:zoom', d),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  readPath: (opts) => ipcRenderer.invoke('file:readPath', opts),
  backupWrite: (opts) => ipcRenderer.invoke('backup:write', opts),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRead: (p) => ipcRenderer.invoke('backup:read', p),
  nativeDark: () => ipcRenderer.invoke('theme:native'),
});
