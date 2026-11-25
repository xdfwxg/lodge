const { contextBridge, ipcRenderer } = require('electron')

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('lodge', {
  chooseDirectory: () => ipcRenderer.invoke('lodge:choose-directory'),
  openPath: target => ipcRenderer.invoke('lodge:open-path', target),
  request: (path, body) => ipcRenderer.invoke('lodge:request', path, body),
  loginRuntime: id => ipcRenderer.invoke('lodge:runtime-login', id),
  syncRooms: rooms => ipcRenderer.send('lodge:rooms', rooms),
  attention: payload => ipcRenderer.send('lodge:attention', payload),
  onOpenRoom: callback => subscribe('lodge:open-room', callback),
  onCommand: callback => subscribe('lodge:command', callback),
})
