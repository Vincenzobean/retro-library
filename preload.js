const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  pickFile: (title) => ipcRenderer.invoke('dialog:pickFile', { title }),
  pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', { title }),
  openSite: (emulatorKey) => ipcRenderer.invoke('shell:openSite', emulatorKey),
  showFile: (file) => ipcRenderer.invoke('shell:showFile', file),
  launch: (gameId, stateFile) => ipcRenderer.invoke('game:launch', { gameId, stateFile }),
  cover: (gameId) => ipcRenderer.invoke('cover:get', gameId),
  fileUrl: (file) => ipcRenderer.invoke('file:url', file),
  quit: () => ipcRenderer.invoke('app:quit'),
  onGameExited: (cb) => ipcRenderer.on('game:exited', (_e, data) => cb(data)),
});
