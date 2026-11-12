const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lodge', {
  chooseDirectory: () => ipcRenderer.invoke('lodge:choose-directory'),
  openPath: target => ipcRenderer.invoke('lodge:open-path', target),
})
