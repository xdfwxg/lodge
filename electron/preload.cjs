const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lodge', {
  chooseDirectory: () => ipcRenderer.invoke('lodge:choose-directory'),
  openPath: target => ipcRenderer.invoke('lodge:open-path', target),
  loginRuntime: id => ipcRenderer.invoke('lodge:runtime-login', id),
})
